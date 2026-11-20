---
phase: implementation
title: Hướng dẫn thực hiện và bàn giao
---

# Hướng dẫn thực hiện và bàn giao

Áp dụng cho việc triển khai [v4](../../../coding-harness-v4.md). Ghi chú triển khai v3.2 (P1–P5, N1–N3) được lưu ở [docs/history/v3.2/implementation.md](../../history/v3.2/implementation.md).

## Điểm xuất phát

| Hạng mục | Đã có | Ghi chú cho v4 |
|---|---|---|
| Codex | CLI 0.171.0 đã kiểm ở v3.2, auth ChatGPT. Custom roles chạy được khi project đã trust và bật `multi_agent_v2`. | M0 kiểm lại version hiện tại, hooks và MCP. |
| Claude Code | 2.1.311 đã kiểm ở v3.2, auth Pro. Static profile read-only (Read/Glob/Grep, MCP rỗng, `dontAsk`) giới hạn được file tool trong fixture. | M0 kiểm plugin, hooks và agent definitions. |
| MCP cá nhân | Stack cá nhân lỗi invalid transport khi khởi động Codex. | Test của Jodex chạy với `mcp_servers` chỉ gồm `jodex`. |
| Snapshot | `scripts/review_snapshot.py` + 7 test đạt (v3.2 P3). | Nguồn port cho `src/snapshot/`. Giữ nguyên hành vi trước, mở rộng sau. |
| Jev | Chủ dự án đã có API key. | Key chỉ để trong env hoặc keychain, không ghi vào repo, log hay report. |
| AI DevKit | CLI 0.77.0, docs/lint dùng được. tmux thiếu nên start/send chưa qualified. | Chỉ dùng cho lifecycle docs của repo này, không phải dependency của Jodex. |

## Quy ước mã nguồn

- Node ≥ 22, TypeScript, ESM. Bin `jodex` trỏ tới `dist/cli.js`.
- Dependency giới hạn ở:
  - `@modelcontextprotocol/sdk`;
  - `@typesafe-ai/sdk`;
  - một TOML parser;
  - một JSON Schema validator.

  Thêm dependency khác cần lý do ghi tại đây.
- Bố cục theo v4 §12:
  - `src/cli` cho CLI;
  - `src/mcp` cho MCP server;
  - `src/hooks` cho hook runner;
  - `src/engine` gồm rules, jev, thresholds, router;
  - `src/run`, `src/snapshot`, `src/schemas`;
  - `roles/` và `adapters/` ở gốc repo.
- Hook runner đọc JSON từ stdin, chuẩn hoá sự kiện theo từng host, và trả output theo đúng contract đã xác minh ở M0.
- Engine không phụ thuộc host. Adapter chỉ chuyển đổi định dạng.
- Mọi ghi file vào cấu hình global đều phải backup trước và có `uninstall` tương ứng. Nội dung managed nằm trong vùng `jodex:begin/end`.
- Test Jev dùng response đã ghi sẵn. Gọi live chỉ diễn ra trong đợt nghiệm thu của milestone, dùng state tổng hợp.

## Thứ tự trong một milestone

1. Đọc spec, planning và testing hiện hành. Chốt allowed files và acceptance rows.
2. Implementer triển khai, chạy kiểm tra local và bàn giao.
3. Unit_tester nhận quyền ghi test, bổ sung coverage cho gap cụ thể, chạy suite và ghi kết quả thật vào testing.
4. Code_reviewer đọc spec, diff và bằng chứng test, không ghi file.
5. Nếu có blocker: trả về đúng implementer cũ, tối đa một vòng sửa, rồi tester và reviewer kiểm lại.
6. Cập nhật planning (trạng thái, bước tiếp theo) và testing (bằng chứng). Báo kết quả theo completion policy trong `AGENTS.md`.

## Nhật ký

- **20/11/2026:**
  - Viết `coding-harness-v4.md` và tự review. Đã sửa: hành vi với prompt không phải task, follow-up trong run đang mở, `jodex_submit_plan`, chuyển writer lock cho tester, phạm vi global/project của `setup`/`init`, no-op ở project chưa init.
  - Lưu tài liệu v3.2 vào `docs/history/v3.2/`.
  - Đổi link static profile trong hai skill harness-* sang README đã lưu.
  - Chưa có code v4.
- **20/11/2026, M1:**
  - Triển khai `src/` (9 file phẳng) và `plugin/` dùng chung cho hai host. Thêm `.claude-plugin/marketplace.json` và `.agents/plugins/marketplace.json`.
  - Dependency runtime chỉ có `smol-toml`, được bundle. Dev dependency: `typescript` 7.0.2, `esbuild` 0.28.2, `@types/node`.
  - Hook fail-open: nếu hook lỗi thì trả `{}` và ghi `~/.jodex/hook-errors.log`, để Jodex không làm kẹt agent.
  - Đã thêm vào `.gitignore`: `node_modules/`, `plugin/dist/`, `.jodex/runs/`, `.jodex/sessions/`, `.env`, `.env.*`.

## DX1 · Chuẩn bị inline status (21/11/2026)

Phạm vi đã đọc: src/cli.ts, setup.ts, run.ts, hooks.ts, decisions.ts, team.ts, checks.ts, plugin manifests/hooks, test callers và README. Run store đã có host/model/awaiting/reviews/mode; không cần tạo session manager. Ponytail cho thấy badge ngắn, màu phụ, native status integration. Codex adapter cần read-only MCP statusline transport đúng native interface; Claude command footer. Triển khai đang bàn giao, chưa có claim hoàn tất.

DX1 implementation ready: src/statusline.ts dùng session-bound read-only render, native Claude JSON và Codex stdio MCP; bounded 128KB decision tail/recent runs; workflow tách native activity. src/cli.ts thêm statusline/setup/uninstall entry; src/setup.ts thêm explicit footer opt-in, backup mode600 và rollback exact-owned, giữ footer cũ và CLAUDE_CONFIG_DIR. Codex manifest trỏ scoped MCP config; README có activation/composition/rollback. Không sửa hooks/run schema hoặc thêm dependency. Source và actual RED/GREEN/build evidence ở `/var/folders/sm/t_3g1b1n3l73b0fjjfylchw00000gn/T/jodex-inline-implementation-8krt8by6/handoff.json`; baseline source copies ở sibling `jodex-inline-before-sw2gglk_`. Parent đã inspect source sau handoff, tester tiếp nhận.

DX1 final handoff: implementer → independent tester → read-only reviewer hoàn tất tuần tự; REVIEW_PASS scoped, không correction cycle. Renderer/setup/CLI/manifest/docs hashes khớp test và review. Source ở working tree, chưa commit. Explicit activation/rollback xem README Inline status. Native visual acceptance còn mở; không có global config changes hoặc provider calls.
