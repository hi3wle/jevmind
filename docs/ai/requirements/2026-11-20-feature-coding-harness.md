---
phase: requirements
title: Mục tiêu và tiêu chí chấp nhận
---

# Mục tiêu và tiêu chí chấp nhận

Nguồn yêu cầu là [Jevmind — Adaptive Coding Harness v4](../../../coding-harness-v4.md), ngày 20/11/2026. v4 thay v3.2 ở vai trò spec sản phẩm. Yêu cầu và bằng chứng của v3.2 được lưu ở [docs/history/v3.2](../../history/v3.2/requirements.md).

## Bài toán

Developer cài harness một lần trên máy (`jevmind setup`), bật nó cho từng project (`jevmind init`), rồi mở Claude Code, Codex hoặc agent khác và prompt như bình thường. Harness tự làm các việc sau:

- phân loại task;
- chọn chế độ solo, review hoặc collaborative;
- điều phối các role plan → challenge → implement → test → review → correct → verify;
- chỉ báo thành công khi bằng chứng hiện hành đủ.

Quyết định đi qua lớp System 1: luật cứng → Jev (TypeSafe) → ngưỡng xác suất. Agent của host (System 2) là bên viết code.

## Quyết định của chủ dự án (20/11/2026)

- Sản phẩm là outer harness cài được: `jevmind setup` global và `jevmind init` theo project.
- Hỗ trợ Claude Code và Codex đầy đủ. Agent khác hỗ trợ best-effort qua `AGENTS.md` + MCP.
- Dùng Jev theo các use case của TypeSafe làm lớp quyết định. Chủ dự án đã có API key.
- Ngôn ngữ triển khai là TypeScript.
- Luồng lõi S0–S8 và các role (planner, worker, tester, reviewer) giữ cấu trúc v3.2.

## Goals

| Goal | Acceptance criteria có thể quan sát | Nghiệm thu |
|---|---|---|
| G0. Cài và gỡ an toàn | Trên máy sạch: clone → `setup` → `init` chạy được. Nội dung `AGENTS.md`/`CLAUDE.md` có sẵn được giữ, diff hiển thị trước khi ghi. `uninstall` khôi phục trạng thái cũ. Hook trong project chưa init là no-op. | M1 · rows 1, 2, 20 |
| G1. Solo tự động, đúng trạng thái | Task rủi ro thấp chạy Mode A không phát sinh subagent. Completion status theo đúng thứ tự ưu tiên. `Stop` hook chặn tuyên bố "xong" sai bằng chứng. Prompt chỉ hỏi đáp thì không tạo run. | M1 · rows 3, 4, 19, 21 |
| G2. Rủi ro và yêu cầu trọng yếu | Path được bảo vệ kéo mode lên tối thiểu B. Review bắt buộc của người còn mở thì không `verified`. Thiếu business rule thì hỏi developer, không đoán. | M1 · rows 5, 6 |
| G3. Phục hồi và bảo toàn công việc | `jevmind resume` re-ground được sau khi mất context. Không có worker trùng. Gặp external edit thì dừng ghi và vô hiệu bằng chứng cũ, không reset. | M1–M2 · rows 12, 17 |
| G4. Team modes B/C | Reviewer mới đọc đúng snapshot, kết quả hợp lệ theo schema. R0→F1→R1 tối đa một vòng sửa. Planner và reviewer không ghi được file. C có plan có revision, challenge từ cùng worker. | M2 · rows 7–11, 18, 22, 24, 25 |
| G5. Jev an toàn và có ích | Enforce từ đầu và log mọi quyết định để đối chiếu. Ở chế độ enforce, Jev chỉ siết chứ không nới quá luật cứng. Jev timeout hoặc lỗi thì fallback về luật, task không bị ảnh hưởng. Dữ liệu chỉ gửi khi có consent. | M3 · rows 13–16, 23 |
| G6. Hiệu chỉnh dựa trên bằng chứng | `jevmind calibrate` đề xuất ngưỡng từ quyết định đã gắn nhãn, không tự áp dụng. Review chéo provider dùng profile đã kiểm. | M4 |

Số thứ tự "row" trỏ tới acceptance matrix ở v4 §13.1.

## Ngoài phạm vi

- Không tự động push, merge hay deploy.
- Không có nhiều writer chạy đồng thời.
- Không có daemon.
- Không fallback sang paid API.
- Không có bộ đánh giá hay optimizer chạy trong phiên coding.

Việc đánh giá giá trị của B/C hoặc Jev (pilot kiểu v3.2 §11.2) là một track riêng, không chặn việc giao M1–M3 dưới dạng opt-in.

## Quyết định đã chốt bổ sung (20/11/2026)

- Phân phối: tạm thời chỉ clone repo.
- Jev: enforce ngay từ đầu, dựa vào calibration TypeSafe công bố. Không có shadow, nhưng mọi quyết định vẫn được ghi log để đối chiếu.
- Dữ liệu gửi TypeSafe: mặc định mức 2 (metadata, prompt, lệnh shell, thông báo lỗi). Mức 3 (source/diff) không bao giờ là mặc định.

## DX1 · Inline agent visibility (21/11/2026)

Chủ dự án chọn **hiển thị chung trong TUI native trước**, thay cho `jevmind watch`. Hiển thị Decision (Jev/rules/fallback), Implementor (host/model thực), workflow stage, role đang được chờ và thông tin quan trọng trong một footer ngắn. Không đổi routing, permissions, review budget hay gọi provider chỉ để hiển thị.

Acceptance: footer gắn đúng project/session, không lẫn run khác; phân biệt Jev đã quan sát với off/fallback/chưa quan sát; không suy ra process running từ một run mở; unknown ghi rõ. Dữ liệu legacy, chưa init, thiếu/corrupt input không làm kẹt host. Không đưa prompt, command, secret, raw error hoặc terminal control từ run vào footer. Giữ statusline/cấu hình của developer, có activation và rollback rõ ràng. Other agents chưa có native display adapter giữ unknown, không giả hỗ trợ.
