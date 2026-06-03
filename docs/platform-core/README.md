# Sylva Platform Documentation

Welcome to the Sylva Platform documentation hub. This directory contains comprehensive guides, references, and technical documentation for the platform.

## 📚 Documentation Index

### Getting Started

| Document | Description | Audience |
|----------|-------------|----------|
| [../README.md](../README.md) | Project overview, features, and quick start | Everyone |
| [getting_started.md](./getting_started.md) | Step-by-step first-time setup guide | New users |
| [installation.md](./deployment/installation.md) | Detailed installation instructions | System administrators |
| [configuration.md](./deployment/configuration.md) | Environment variables and configuration options | System administrators |

### Architecture & Design

| Document | Description | Audience |
|----------|-------------|----------|
| [architecture.md](./architecture/architecture.md) | High-level system architecture | Architects, developers |
| [frontend_architecture.md](./architecture/frontend_architecture.md) | Frontend component and state architecture | Frontend developers |
| [backend_architecture.md](./architecture/backend_architecture.md) | Backend service and API architecture | Backend developers |
| [database_schema.md](./architecture/database_schema.md) | Entity-relationship diagrams and schema | Database engineers |
| [websocket_protocol.md](./architecture/websocket_protocol.md) | WebSocket event protocol specification | Full-stack developers |
| [security_architecture.md](./architecture/security_architecture.md) | Authentication, RBAC, and security model | Security engineers |

### API Reference

| Document | Description | Audience |
|----------|-------------|----------|
| [openapi.yaml](../openapi.yaml) | OpenAPI 3.0 specification (machine-readable) | API consumers |
| [api/authentication.md](./api/authentication.md) | Authentication and authorization endpoints | API consumers |
| [api/agents.md](./api/agents.md) | Agent management endpoints | API consumers |
| [api/channels.md](./api/channels.md) | Channel and messaging endpoints | API consumers |
| [api/logs.md](./api/logs.md) | Logging endpoints | API consumers |
| [api/memory.md](./api/memory.md) | Memory management endpoints | API consumers |
| [api/security.md](./api/security.md) | Security and RBAC endpoints | API consumers |
| [api/settings.md](./api/settings.md) | Settings and configuration endpoints | API consumers |
| [api/system.md](./api/system.md) | System and health endpoints | API consumers |
| [api/files.md](./api/files.md) | File upload and processing endpoints | API consumers |
| [api/backup.md](./api/backup.md) | Backup and recovery endpoints | API consumers |

### Development

| Document | Description | Audience |
|----------|-------------|----------|
| [development_setup.md](./development/development_setup.md) | Local development environment setup | Contributors |
| [coding_standards.md](./development/coding_standards.md) | Code style, linting, and formatting rules | Contributors |
| [testing_guide.md](./development/testing_guide.md) | Unit, integration, and E2E testing | Contributors |
| [frontend_development.md](./development/frontend_development.md) | Frontend-specific development guide | Frontend developers |
| [backend_development.md](./development/backend_development.md) | Backend-specific development guide | Backend developers |
| [agent_development.md](./development/agent_development.md) | Custom agent development guide | Agent developers |
| [lean_integration.md](./development/lean_integration.md) | Integrating Lean 4 formalization | Formal verification engineers |

### Deployment

| Document | Description | Audience |
|----------|-------------|----------|
| [docker_deployment.md](./deployment/docker_deployment.md) | Docker and Docker Compose deployment | DevOps |
| [kubernetes_deployment.md](./deployment/kubernetes_deployment.md) | Kubernetes deployment manifests | DevOps |
| [environment_variables.md](./deployment/environment_variables.md) | Complete environment variable reference | DevOps, administrators |
| [scaling.md](./deployment/scaling.md) | Horizontal scaling and performance tuning | DevOps |
| [monitoring.md](./deployment/monitoring.md) | Metrics, logging, and alerting | DevOps |
| [backup_recovery.md](./deployment/backup_recovery.md) | Backup strategies and disaster recovery | DevOps, administrators |

### Formal Verification

| Document | Description | Audience |
|----------|-------------|----------|
| [../sylva_compiler/architecture.md](../sylva_compiler/architecture.md) | Compiler line architecture | Formal verification engineers |
| [../sylva_compiler/sorry_pipeline.md](../sylva_compiler/sorry_pipeline.md) | Sorry-to-exact proof pipeline | Formal verification engineers |
| [../sylva_compiler/amputation_strategy.md](../sylva_compiler/amputation_strategy.md) | Amputation and recovery strategy | Formal verification engineers |
| [../sylva_academic/architecture.md](../sylva_academic/architecture.md) | Academic line architecture | Researchers |
| [../sylva_academic/cnf_framework.md](../sylva_academic/cnf_framework.md) | CNF layered network framework | Researchers |
| [../sylva_academic/toe_framework.md](../sylva_academic/toe_framework.md) | TOE 15 constants framework | Researchers |
| [../sylva_academic/paper_pipeline.md](../sylva_academic/paper_pipeline.md) | Paper production pipeline | Researchers |

### Agent Ecosystem

| Document | Description | Audience |
|----------|-------------|----------|
| [../sylva_software/architecture.md](../sylva_software/architecture.md) | Software line architecture | Agent developers |
| [../sylva_software/agent_writing.md](../sylva_software/agent_writing.md) | Agent writing system overview | Agent developers |
| [../sylva_software/hallucination_system.md](../sylva_software/hallucination_system.md) | Hallucination detection system | Agent developers |
| [../sylva_software/audit_innovation.md](../sylva_software/audit_innovation.md) | Audit-innovation agent chain | Agent developers |
| [../sylva_software/openclaw_optimization.md](../sylva_software/openclaw_optimization.md) | OpenClaw runtime optimization | Agent developers |
| [agent_writing_system/架构设计.md](../sylva_software/agent_writing_system/架构设计.md) | Agent cluster writing architecture (Chinese) | Agent developers |
| [agent_writing_system/代码框架.md](../sylva_software/agent_writing_system/代码框架.md) | Agent cluster code framework (Chinese) | Agent developers |
| [agent_writing_system/通信协议与状态机.md](../sylva_software/agent_writing_system/通信协议与状态机.md) | Agent communication protocol (Chinese) | Agent developers |
| [agent_writing_system/配置与部署.md](../sylva_software/agent_writing_system/配置与部署.md) | Agent deployment configuration (Chinese) | Agent developers |
| [agent_writing_system/API与示例.md](../sylva_software/agent_writing_system/API与示例.md) | Agent API and examples (Chinese) | Agent developers |

### Mega Coordinator

| Document | Description | Audience |
|----------|-------------|----------|
| [../mega_coordinator.md](../mega_coordinator.md) | Mega Coordinator complete design | Architects |

### Operations

| Document | Description | Audience |
|----------|-------------|----------|
| [troubleshooting.md](./troubleshooting.md) | Common issues and solutions | Everyone |
| [performance_tuning.md](./performance_tuning.md) | Performance optimization guide | Administrators |
| [migration_guide.md](./migration_guide.md) | Version migration instructions | Administrators |
| [security_hardening.md](./security_hardening.md) | Security hardening checklist | Security engineers |

## 🔗 Quick Links

- **Live Platform**: [http://localhost:5173](http://localhost:5173) (local development)
- **API Docs**: [http://localhost:3000/api/docs](http://localhost:3000/api/docs) (Swagger UI)
- **Health Check**: [http://localhost:3000/health](http://localhost:3000/health)
- **GitHub Repository**: [https://github.com/sylva-platform/sylva](https://github.com/sylva-platform/sylva)
- **Issue Tracker**: [https://github.com/sylva-platform/sylva/issues](https://github.com/sylva-platform/sylva/issues)
- **Discussions**: [https://github.com/sylva-platform/sylva/discussions](https://github.com/sylva-platform/sylva/discussions)

## 📖 Reading Guide

### For New Users
1. Start with the [main README](../README.md)
2. Follow the [getting started guide](./getting_started.md)
3. Explore the [API documentation](./api/)

### For Developers
1. Read the [development setup guide](./development/development_setup.md)
2. Review [coding standards](./development/coding_standards.md)
3. Study the [architecture documents](./architecture/)
4. Check out the [testing guide](./development/testing_guide.md)

### For DevOps
1. Read the [installation guide](./deployment/installation.md)
2. Review [Docker deployment](./deployment/docker_deployment.md)
3. Study the [monitoring guide](./deployment/monitoring.md)
4. Check [backup and recovery](./deployment/backup_recovery.md)

### For Researchers
1. Read the [academic line architecture](../sylva_academic/architecture.md)
2. Study the [CNF framework](../sylva_academic/cnf_framework.md)
3. Explore the [TOE framework](../sylva_academic/toe_framework.md)
4. Review the [paper pipeline](../sylva_academic/paper_pipeline.md)

## 📝 Contributing to Documentation

We welcome documentation improvements! Please see the [Contributing Guide](../CONTRIBUTING.md) for details.

### Documentation Standards
- All documentation is written in Markdown
- Code examples should be tested and working
- Architecture diagrams use Mermaid syntax
- API documentation is auto-generated from OpenAPI spec
- Keep language clear and concise
- Include examples wherever possible

---

<p align="center">
  <strong>Sylva Platform Documentation</strong><br>
  <em>"Don't worry. Even if the world forgets, I'll remember for you."</em><br>
  <sub>Last updated: 2026-05-19</sub>
</p>
