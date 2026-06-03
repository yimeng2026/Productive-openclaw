package adapters

// A2AAgentCard — Google A2A 协议兼容的 Agent 能力描述
// 每个 Agent 启动时自动生成并广播，供跨平台发现与协商
type A2AAgentCard struct {
	AgentID      string              `json:"agent_id"`
	Name         string              `json:"name"`
	Version      string              `json:"version"`
	Capabilities A2ACapabilities   `json:"capabilities"`
	Endpoints    A2AEndpoints        `json:"endpoints"`
	Auth         A2AAuth             `json:"authentication"`
	Policies     A2APolicies         `json:"policies"`
}

type A2ACapabilities struct {
	Models     []string `json:"models"`     // 支持的模型列表
	Skills     []string `json:"skills"`     // 技能标签
	Languages  []string `json:"languages"`  // 语言
	Modalities []string `json:"modalities"` // 模态
}

type A2AEndpoints struct {
	Task    string `json:"task"`    // 任务提交端点
	Stream  string `json:"stream"`  // WebSocket 流端点
	Health  string `json:"health"`  // 健康检查
}

type A2AAuth struct {
	Type   string `json:"type"`    // hmac-sha256 / oauth2 / apikey
	KeyID  string `json:"key_id"`
}

type A2APolicies struct {
	MaxConcurrent int    `json:"max_concurrent_tasks"`
	TimeoutSec    int    `json:"timeout_seconds"`
	RetryPolicy   string `json:"retry_policy"`
}

// A2ATask — A2A 协议 Task 生命周期
// CREATED → SUBMITTED → WORKING → INPUT_REQUIRED → COMPLETED
// 或 CANCELLED / FAILED
type A2ATask struct {
	TaskID     string          `json:"task_id"`
	State      A2ATaskState    `json:"state"`
	AgentCard  *A2AAgentCard   `json:"agent_card,omitempty"`
	Input      json.RawMessage `json:"input"`
	Output     json.RawMessage `json:"output,omitempty"`
	Artifacts  []A2AArtifact   `json:"artifacts,omitempty"`
	History    []A2AMessage    `json:"history"`
	Metadata   A2ATaskMeta     `json:"metadata"`
}

type A2ATaskState string

const (
	TaskStateCreated         A2ATaskState = "CREATED"
	TaskStateSubmitted       A2ATaskState = "SUBMITTED"
	TaskStateWorking         A2ATaskState = "WORKING"
	TaskStateInputRequired   A2ATaskState = "INPUT_REQUIRED"
	TaskStateCompleted       A2ATaskState = "COMPLETED"
	TaskStateFailed          A2ATaskState = "FAILED"
	TaskStateCancelled       A2ATaskState = "CANCELLED"
)

type A2AArtifact struct {
	Type    string `json:"type"`  // file / log / code / diff
	Mime    string `json:"mime"`
	URI     string `json:"uri,omitempty"`
	Content string `json:"content,omitempty"`
}

type A2AMessage struct {
	Role  string      `json:"role"`  // agent / user / system
	Parts []A2APart   `json:"parts"`
}

type A2APart struct {
	Type    string `json:"type"`     // text / file / data
	Content string `json:"content"`
}

type A2ATaskMeta struct {
	StartedAt   time.Time `json:"started_at"`
	LastUpdated time.Time `json:"last_updated"`
	TurnCount   int       `json:"turn_count"`
}

// A2AProtocolBridge — 将内部 Swarm 消息格式桥接到 A2A 标准
// 实现跨平台、跨框架的 Agent 互操作
type A2AProtocolBridge struct {
	Registry *AdapterRegistry
}

// NewA2AProtocolBridge 创建桥接器
func NewA2AProtocolBridge(registry *AdapterRegistry) *A2AProtocolBridge {
	return &A2AProtocolBridge{Registry: registry}
}

// ToA2ATask 将内部 SwarmMessage 转换为 A2A Task
func (b *A2AProtocolBridge) ToA2ATask(msg SwarmMessage) *A2ATask {
	return &A2ATask{
		TaskID: msg.ID,
		State:  b.mapState(msg.Status),
		Input:  msg.Payload,
		History: []A2AMessage{
			{
				Role: "agent",
				Parts: []A2APart{{
					Type:    "text",
					Content: string(msg.Payload),
				}},
			},
		},
		Metadata: A2ATaskMeta{
			StartedAt:   msg.Timestamp,
			LastUpdated: time.Now(),
			TurnCount:   1,
		},
	}
}

// FromA2ATask 将 A2A Task 转换为内部 SwarmMessage
func (b *A2AProtocolBridge) FromA2ATask(task *A2ATask) SwarmMessage {
	return SwarmMessage{
		ID:        task.TaskID,
		From:      AgentID{Platform: "a2a", ID: task.AgentCard.AgentID},
		To:        AgentID{Platform: "internal", ID: "coordinator"},
		Type:      b.mapMessageType(task.State),
		Payload:   task.Input,
		Timestamp: task.Metadata.StartedAt,
		Status:    b.mapStatus(task.State),
	}
}

func (b *A2AProtocolBridge) mapState(status string) A2ATaskState {
	switch status {
	case "pending":
		return TaskStateSubmitted
	case "running":
		return TaskStateWorking
	case "completed":
		return TaskStateCompleted
	case "failed":
		return TaskStateFailed
	default:
		return TaskStateCreated
	}
}

func (b *A2AProtocolBridge) mapStatus(state A2ATaskState) string {
	switch state {
	case TaskStateCompleted:
		return "completed"
	case TaskStateFailed:
		return "failed"
	case TaskStateWorking:
		return "running"
	default:
		return "pending"
	}
}

func (b *A2AProtocolBridge) mapMessageType(state A2ATaskState) MessageType {
	switch state {
	case TaskStateCompleted:
		return MsgTypeResult
	case TaskStateFailed:
		return MsgTypeError
	default:
		return MsgTypeTask
	}
}
