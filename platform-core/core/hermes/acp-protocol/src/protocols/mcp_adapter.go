package protocols

// MCPProtocolAdapter — Anthropic MCP 协议适配层
// 将 MCP Server/Client 模式接入 Swarm 系统
// MCP = "AI 的 USB-C"：标准化工具/数据/上下文接入

import (
	"encoding/json"
	"fmt"
)

// MCPServerDefinition MCP Server 定义
type MCPServerDefinition struct {
	Name        string          `json:"name"`
	Version     string          `json:"version"`
	Tools       []MCPTool       `json:"tools"`
	Resources   []MCPResource   `json:"resources,omitempty"`
	Prompts     []MCPPrompt     `json:"prompts,omitempty"`
}

// MCPTool MCP 工具定义
type MCPTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

// MCPResource MCP 资源定义
type MCPResource struct {
	URI         string `json:"uri"`
	Name        string `json:"name"`
	MimeType    string `json:"mimeType,omitempty"`
	Description string `json:"description,omitempty"`
}

// MCPPrompt MCP 提示模板
type MCPPrompt struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Arguments   []string `json:"arguments,omitempty"`
}

// MCPCallRequest MCP 工具调用请求
type MCPCallRequest struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

// MCPCallResult MCP 工具调用结果
type MCPCallResult struct {
	Content []MCPContent `json:"content"`
	IsError bool         `json:"isError,omitempty"`
	Error   string       `json:"error,omitempty"`
}

// MCPContent MCP 内容块
type MCPContent struct {
	Type string `json:"type"` // text / image / resource
	Text string `json:"text,omitempty"`
	URI  string `json:"uri,omitempty"`
}

// MCPClient MCP 客户端接口
// 每个 Agent 可以持有多个 MCP Client，连接不同 Server
type MCPClient interface {
	ListTools() ([]MCPTool, error)
	CallTool(req MCPCallRequest) (*MCPCallResult, error)
	ListResources() ([]MCPResource, error)
	ReadResource(uri string) (*MCPContent, error)
}

// SwarmMCPBridge 将 MCP 工具接入 Swarm Agent 的工具链
type SwarmMCPBridge struct {
	Clients map[string]MCPClient // server_name → client
}

// NewSwarmMCPBridge 创建桥接器
func NewSwarmMCPBridge() *SwarmMCPBridge {
	return &SwarmMCPBridge{Clients: make(map[string]MCPClient)}
}

// RegisterServer 注册 MCP Server
func (b *SwarmMCPBridge) RegisterServer(name string, client MCPClient) {
	b.Clients[name] = client
}

// QueryMemory MCP 工具实现：查询分层记忆系统
// 对应外部调研中的 Hermes 4 记忆架构
func (b *SwarmMCPBridge) QueryMemory(query string, mode string, maxResults int) ([]byte, error) {
	// 调用内部 memory_search 工具
	req := MCPCallRequest{
		Name: "query_memory",
		Arguments: mustJSON(map[string]any{
			"query":       query,
			"mode":        mode,
			"max_results": maxResults,
		}),
	}

	client, ok := b.Clients["sylva-knowledge-base"]
	if !ok {
		return nil, fmt.Errorf("knowledge base MCP server not registered")
	}

	result, err := client.CallTool(req)
	if err != nil {
		return nil, err
	}

	if len(result.Content) > 0 {
		return []byte(result.Content[0].Text), nil
	}
	return nil, fmt.Errorf("no content returned")
}

// BindKnowledge MCP 工具实现：绑定外部知识源
// 对应用户提到的 "知识库绑定完成"
func (b *SwarmMCPBridge) BindKnowledge(sourceType string, sourceURI string, bindMode string, ttlSeconds int) error {
	req := MCPCallRequest{
		Name: "bind_knowledge",
		Arguments: mustJSON(map[string]any{
			"source_type": sourceType,
			"source_uri":  sourceURI,
			"bind_mode":   bindMode,
			"ttl_seconds": ttlSeconds,
		}),
	}

	client, ok := b.Clients["sylva-knowledge-base"]
	if !ok {
		return fmt.Errorf("knowledge base MCP server not registered")
	}

	_, err := client.CallTool(req)
	return err
}

func mustJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
