---
phase: design
title: Review kiến trúc và quyết định triển khai
---

# Review kiến trúc và quyết định triển khai

Thiết kế chi tiết nằm trong [coding-harness-v4.md](../../../coding-harness-v4.md). Tài liệu này ghi lý do đổi từ v3.2 sang v4 và các quyết định cần giữ khi triển khai. Review kiến trúc của v3.2 được lưu ở [docs/history/v3.2/design.md](../../history/v3.2/design.md).

## Review v3.2 dưới góc độ sản phẩm cài được

| Điểm yếu của v3.2 | Hậu quả | Điều chỉnh ở v4 |
|---|---|---|
| Non-goals cấm framework, server và provider abstraction. Bản thân sản phẩm chỉ là instruction pack. | Không cài được. Người dùng phải tự copy `SKILL.md`. | CLI, MCP server và hook runner bằng TypeScript. Có adapter mỏng cho từng host. |
| Codex luôn là writer, Claude chỉ plan và review. | Người chỉ dùng Claude Code không có Mode A. | Host nào cũng có thể là worker. Planner và reviewer chạy bằng subagent native, review chéo provider là tuỳ chọn. |
| Mode chỉ chọn thủ công, Jev bị hoãn. | Không có điều phối tự động. | S1 route theo luật cứng → Jev → ngưỡng. Developer vẫn ghi đè được. |
| Luật chỉ nằm trong prose: một writer, schema review, thứ tự completion. | Phụ thuộc vào việc model có tuân thủ hay không, và khó kiểm. | Đưa vào code: writer lock, validate JSON Schema, `jevmind_complete`, `Stop` hook. |
| Gắn chặt với máy cá nhân: đường dẫn tuyệt đối, version CLI, model ID cứng, 21 skill AI DevKit global, tmux. | Không chạy trên máy khác. | `jevmind doctor` dò năng lực từng host. Model khai báo trong `.jevmind/config.toml`. AI DevKit chỉ là adapter tuỳ chọn. |
| Hai khái niệm "multi-agent" bị trộn: B/C chéo provider và quy trình role để phát triển repo. | Dễ hiểu nhầm phạm vi. | Runtime modes thuộc sản phẩm. Quy trình Codex roles chỉ dùng để phát triển repo này (AGENTS.md). |
| Phần nghiên cứu (pilot H2, Lab, Jev H4) nằm chung với runtime. | Spec dài, khó triển khai. | Tách thành track đánh giá riêng. Jev enforce ngay từ đầu, ghi log mọi quyết định, sau đó calibrate. |

## Quyết định kiến trúc

1. **System 1 / System 2.** Jev chỉ ra quyết định có kiểu (`choice`, `noul`, `score`) kèm xác suất. Jev không sinh code hay plan. TypeSafe tự định vị coding agent là việc của LLM, nên vai trò hợp lý của Jev là lớp quyết định bọc quanh agent.
2. **Hook là kênh chính, MCP là kênh phụ.** Hook (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`) giúp quyết định không phụ thuộc vào việc agent có tự gọi tool hay không. MCP cung cấp state machine và các tool cho agent. Hai kênh dùng chung engine và run store.
3. **Bất đối xứng.** Jev được tự động siết lại; muốn nới ra cần ngưỡng cao và không được vượt luật cứng. Jev không bao giờ cấp quyền hay đóng gate review hoặc test.
4. **Enforce ngay, ghi log để đối chiếu** (chủ dự án quyết định ngày 20/11/2026). Dựa vào calibration TypeSafe công bố, không có giai đoạn shadow. Mọi quyết định đều ghi vào `decisions.jsonl` để đối chiếu và chạy `jevmind calibrate` về sau. Lưới an toàn thay cho shadow là luật cứng cộng bất đối xứng. `shadow` vẫn là tuỳ chọn cho từng điểm quyết định nếu điểm đó hoạt động sai.
5. **Dữ liệu gửi TypeSafe mặc định mức 2** (metadata, prompt, lệnh shell, thông báo lỗi). Mức 3 (source/diff) không bao giờ là mặc định, chỉ bật thủ công theo từng project. Không có consent thì chỉ chạy luật cứng.
6. **Giữ luồng v3.2.** Giữ S0–S8, một worker xuyên suốt S3/S4/S6a, reviewer luôn là phiên mới và không đọc transcript, R0→F1→R1, thứ tự completion, và snapshot gắn với revision.
7. **Thêm role tester riêng cho B/C.** Lấy từ quy trình implementer/unit_tester/reviewer. Writer lock được chuyển cho tester và chỉ giới hạn ở test globs.
8. **Planner không ghi file.** Plan được nộp qua `jevmind_submit_plan`, Jevmind lưu và cấp `planRevision`.
9. **Phạm vi cài đặt.** Hook và MCP cài global. Project chưa `init` thì mọi hook là no-op. `init` chỉ ghi config, khối managed trong `AGENTS.md`, import trong `CLAUDE.md`, và file role/hook cấp project khi host không nạp được bản global.

## Tái sử dụng từ v3.2

| Artifact | Cách dùng |
|---|---|
| `scripts/review_snapshot.py` + 7 test | Port sang `src/snapshot/`; bộ test làm acceptance cho bản port |
| Static profile của native Claude (archived README) | Tham chiếu cho review chéo provider (§9.4) |
| Ba skill harness-* | Rút gọn thành role prompt (§5) và skill `jevmind` |
| `.codex/agents/*.toml` | Mẫu cho `adapters/codex/`; model khai báo qua config |
| Bằng chứng N1/N2/N3/P5 | Chứng minh khả năng vận hành của luồng thủ công; không chứng minh hành vi của v4 |

## Rủi ro thiết kế

- Hook của Codex và danh tính subagent trong input của hook chưa xác minh. Nếu thiếu, Codex chạy ở instruction mode, không có D2/D3 và không enforce được writer lock bằng hook.
- Độ trễ của Jev tính từ mạng của developer chưa đo. D2 nằm trên đường gọi tool nên cần cache và allowlist.
- Instruction mode ở host không có hook phụ thuộc vào việc model có tuân thủ hay không. Mức tuân thủ này cần được đo ở M1.

## DX1 · Native footer

Dùng một renderer nhỏ đọc run/session/decision hiện có, không tạo dashboard/TUI thứ hai hoặc event store mới. Host input là nguồn của project/session/model và live activity (nếu được cung cấp); run store là nguồn workflow/awaited role, không phải process liveness. Footer chỉ đọc; không gọi evaluate với source scan mỗi tick, không expire/save run, không gọi Jev. Check/outcome nếu hiện phải nêu last recorded, không khẳng định evidence còn current.

Claude Code: `jevmind statusline` nhận JSON stdin, xuất text footer; cấu hình bằng settings statusLine command. Codex: `jevmind statusline --mcp` là local read-only stdio MCP theo create-statusline sample chính thức, tool advertise statusline resource; `resources/read` nhận displayed-thread state, trả UI tree. Chỉ gắn MCP cho Codex manifest, không thay đổi workflow tools. Codex cần Custom status line trong /experimental và chọn Jevmind qua /statusline; không tự bật experimental/ghi đè lựa chọn.

Activation Claude phải bảo toàn statusline đã có: mặc định không thay thế cấu hình developer. Nếu chưa có thì setup cài command và rollback chỉ gỡ đúng cấu hình Jevmind sở hữu; nếu đã có thì cung cấp đường compose rõ ràng, không tự thực thi/ghi đè command đó trong setup. Không tự chỉnh cấu hình global ở lượt triển khai; kiểm bằng home cô lập.

Nguồn đã kiểm: Claude settings/statusline docs; Codex create-statusline SKILL.md, assets/statusline.py, references/statusline.d.ts trên openai/codex main. Installed Codex 0.171.0 có tui_extensions_statusline experimental=false; Claude 2.1.311. Transport provider bám sample stdio newline, không thêm dependency MCP framework.

Native footer references: [Claude statusline](https://code.claude.com/docs/en/statusline), [plugin defaults limits](https://code.claude.com/docs/en/plugins/components), [Codex create-statusline](https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/create-statusline/SKILL.md). Installed feature availability is not proof of activated rendering.

### DX1 F1 native compatibility correction

Installed Codex0.171.0 legacy plugin loader does not expand either PLUGIN_ROOT or CLAUDE_PLUGIN_ROOT in MCP argv, despite the newer agent-plugin docs. Confirmed through isolated native marketplace installation and app-server MCP startup failure. Use the already-installed `jevmind statusline --mcp` executable through PATH, which setup links before plugin install. No per-machine path generation or second registration mechanism. Native discovery through mcpServerStatus/list is now an acceptance check, in addition to direct protocol smoke.
