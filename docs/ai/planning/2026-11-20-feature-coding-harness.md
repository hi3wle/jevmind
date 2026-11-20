---
phase: planning
title: Kế hoạch triển khai và trạng thái
---

# Kế hoạch triển khai và trạng thái

Đây là backlog chính của feature. Cập nhật trạng thái trên từng dòng mỗi khi bàn giao.

- "Đã chuẩn bị" nghĩa là artifact đã sẵn sàng cho đợt nghiệm thu.
- "Đạt" cần có kết quả ghi ở testing.

Spec: [coding-harness-v4.md](../../../coding-harness-v4.md). Backlog v3.2 (P0–P6, H0–H5) đã đóng, lưu ở [docs/history/v3.2/planning.md](../../history/v3.2/planning.md).

**Trạng thái hiện tại:**
- DX1 inline native footer đã qua local test/smoke và REVIEW_PASS (21/11); chờ bật/chọn và nghiệm thu hiển thị TUI thật.
- Spec v4 đã viết và tự review. Toàn bộ tài liệu đã chuyển sang v4.
- Chưa có code v4.
- M0 đã chạy xong.
- Đã sửa spec theo ponytail review (finding 1–5).
- M1 đã triển khai và kiểm trên cả hai host.
- Đã cài thật (`jodex setup`) trên máy chủ dự án. Đã có repo thử `optimize-lab` và dashboard `jodex board`.
- **Bước tiếp theo:** chủ dự án trust hook Jodex trong Codex (`/hooks`), review M1, rồi M2.

## Milestones

| ID | Phụ thuộc / phụ trách | Việc và đầu ra | Goal / bằng chứng | Trạng thái |
|---|---|---|---|---|
| V4.0 | — / chủ dự án + Claude | Review v3.2, chốt hướng v4, viết spec, chuyển tài liệu | requirements, design | Hoàn tất |
| M0 | V4.0 / implementer + unit_tester | Kiểm từng mục **[verify M0]** trên Claude Code và Codex đang cài; smoke Jev SDK và đo latency; ghi capability matrix; sửa spec ở chỗ giả định sai | G0–G5 (tiền đề) / `testing/m0-capability-report.json` | Hoàn tất ngày 20/11/2026; xem testing |
| M1 | M0 / implementer → unit_tester → code_reviewer | Scaffold TypeScript; CLI `setup`/`init`/`doctor`/`status`/`resume`/`uninstall`; MCP server; run store; rules engine; Mode A; completion gate; adapter Claude Code; Codex ở instruction mode (hoặc hook nếu M0 xác nhận) | G0–G3 / rows 1–6, 17, 19–21 | Đã triển khai, test và chạy live; chờ chủ dự án review và cài thật |
| M2 | M1 | Port snapshot; role planner/tester/reviewer; writer lock; `jodex_submit_plan`/`challenge`/`review`; R0→F1→R1; Mode B/C trên cả hai host | G3–G4 / rows 7–12, 18, 22, 24, 25 | Chưa bắt đầu |
| M3 | M1 (D1, D5); M2 (D4) | Engine Jev: D1–D5 enforce mặc định; `decisions.jsonl`; consent và data level (mặc định 2) trong `init`; timeout/fallback | G5 / rows 13–16, 23 | Chưa bắt đầu |
| M4 | M3 + đủ quyết định đã gắn nhãn | `jodex calibrate`, `accept`/`reject`; D6 định tuyến model; review chéo provider | G6 | Chưa bắt đầu |
| EV | Tùy chọn, khi chủ dự án mở | Track đánh giá giá trị B/C/Jev (seeded pilot, so sánh end-to-end) | `docs/evaluation.md` | Chưa mở |

## Checklist M0

- [x] Ghi version của Claude Code, Codex, Node (≥ 22) và `@typesafe-ai/sdk`.
- [x] Claude Code plugin:
  - [x] layout plugin và cách cài local;
  - [x] hook events và output contract: `UserPromptSubmit` thêm context, `PreToolUse` allow/ask/deny, `Stop`/`SubagentStop` block;
  - [x] danh tính session/subagent trong input của hook;
  - [x] tool allowlist theo agent definition.
- [x] Codex:
  - [x] đăng ký MCP trong `~/.codex/config.toml`;
  - [x] có hook không, và gồm những event nào;
  - [x] subagent (`multi_agent_v2`) và role toml global hay theo project;
  - [x] sandbox read-only cho role;
  - [x] profile `codex exec` cho review chéo provider.
- [x] Jev:
  - [x] gọi `choice`/`noul`/`score` bằng state giả;
  - [x] ghi model version và usage;
  - [x] đo latency p50/p95 từ máy developer;
  - [x] kiểm hành vi timeout và lỗi.
  - Chỉ dùng dữ liệu tổng hợp, không gửi source thật.
- [x] Viết capability matrix (supported / unsupported / unknown), mỗi kết luận có nguồn.
- [x] Sửa v4 ở những chỗ giả định sai, ghi quyết định vào design.

Acceptance M0: matrix có bằng chứng cho mọi mục **[verify M0]**, và spec đã cập nhật theo kết quả. Không ghi vào cấu hình global của developer khi chưa được phép. Mọi probe chạy trên thư mục tạm.

## Quy tắc điều phối

- Phát triển repo theo quy trình approved-plan trong `AGENTS.md`, với các Codex role chạy tuần tự.
- Planning giữ trạng thái, testing giữ bằng chứng.
- Mỗi milestone gom các kiểm tra live (host và Jev) vào một đợt nghiệm thu riêng.
- Không gửi `TYPESAFE_API_KEY` hay source dự án thật ra ngoài phạm vi đã duyệt.

## Câu hỏi còn mở

- ~~Kênh phân phối~~ Đã chốt 20/11/2026: tạm thời chỉ phân phối bằng clone repo. Publish npm và marketplace để sau.
- ~~N task trước enforce~~ Đã chốt 20/11/2026: không có shadow; enforce ngay và ghi log để đối chiếu.
- ~~Phạm vi dữ liệu~~ Đã chốt 20/11/2026: mặc định mức 2; mức 3 không bao giờ là mặc định.

## Kết quả M1 (20/11/2026)

- [x] Cài đặt dùng marketplace có sẵn của từng host. Repo này vừa là marketplace của Claude Code (`.claude-plugin/marketplace.json`) vừa là marketplace của Codex (`.agents/plugins/marketplace.json`). Plugin dùng chung nằm ở `plugin/`. Không tự sửa file config của host.
- [x] CLI gồm `setup`, `init`, `check`, `status`, `resume`, `accept`/`reject`, `doctor`, `uninstall [--project [--purge]]` và `hook`.
- [x] Hook `UserPromptSubmit`, `PreToolUse` (ghi file) và `Stop` dùng chung cho cả hai host. Mode A, cổng hoàn tất chặn tối đa một lần, risk floor theo glob.
- [x] 17 unit/integration test.

Thay đổi so với spec ban đầu, đã ghi vào v4:
- Chưa có MCP server ở M1. Bằng chứng kiểm tra đi qua `jodex check`.
- Identity chuyển sang băm nội dung file trong process, vì sandbox của Codex không cho ghi vào `.git`.

Còn mở:
- Chưa chạy `jodex setup` trên cấu hình thật của chủ dự án; mới kiểm trong home cô lập.
- Trust hook Codex qua `/hooks` cần người làm trong TUI.
- Run critical luôn ở `review_required` cho tới M2.

## M1 mở rộng: cài thật, optimize-lab, dashboard (20/11/2026)

- [x] `jodex setup` trên cấu hình thật: npm link vào `/opt/homebrew/bin/jodex`, plugin `jodex@jodex` đã cài vào Claude Code (đọc trực tiếp từ `plugin/`) và Codex (bản sao trong cache, chạy lại `setup` để làm mới).
- [x] Repo thử `/Volumes/WD-EXTERNAL/Personal/optimize-lab`: backend shop nhỏ, `TASKS.md` gồm T1–T6, đã `jodex init`.
- [x] `jodex board`: dashboard HTML tại chỗ, kiểu ponytail. Có danh sách project, KPI, biểu đồ theo trạng thái/thời gian/số file, bảng run, outcome và risk, heatmap. Có giao diện sáng/tối.
- [x] Run ghi thêm `host`, `model` (Codex) và `stopBlocks`.
- [ ] Trust hook Jodex trong Codex TUI (`/hooks`): chủ dự án làm.

## Sửa finding 3, 5 và đưa Jev D1 lên trước M2 (20/11/2026)

- [x] Finding 3: xoá file session khi agent dừng; xoá các file cũ hơn 7 ngày khi có prompt mới.
- [x] Finding 5: log lỗi hook nằm dưới `JODEX_HOME`.
- [x] Board hiển thị model của từng run: Codex lấy từ hook, Claude Code đọc từ transcript. Kèm chip phiên bản Jev và nhãn "raised by Jev".
- [x] **Jev D1 được đưa lên trước M2 theo yêu cầu chủ dự án.** Gồm: 4 câu hỏi lúc nhận prompt, chính sách ngưỡng chỉ được siết, che secret, `decisions.jsonl`, `jodex key`, `jodex init --jev`, khu "How Jev decides" và các ô calibration trên board.
- [ ] M2 (team modes) tiếp theo; D4 (phân loại finding) sẽ đi cùng M2.
- Finding 4 (băm toàn repo nhiều lần mỗi lượt) vẫn mở.

## M2 team modes (20/11/2026)

- [x] Role prompts `plugin/agents/{planner,reviewer,tester}.md`, dùng chung cho cả hai host.
- [x] Các lệnh `jodex plan|test|review start`, `jodex plan accept|revise|block`, và dòng `Next:` trong output.
- [x] Kết quả role lấy qua `SubagentStop`. Kiểm tra ReviewResult và các invariant; output sai được trả lại một lần.
- [x] Quyền theo stage: planner và reviewer chỉ đọc; tester chỉ ghi file test; worker bị khoá khi đang chờ subagent; collaborative phải có plan được chấp nhận trước khi sửa.
- [x] Ngân sách sửa lỗi R0→F1→R1; review bị coi là cũ khi source đổi; D4 qua Jev.
- [x] Gói review đúng phạm vi run (base của từng file); run chỉ đóng khi bước tiếp theo thuộc về developer; prompt mới được nhắc về run còn dang dở; `jodex accept` thoả review bắt buộc của người.
- [x] Board hiển thị mode, các vòng review, số plan, và khu D4.
- [ ] MCP server: không cần cho M2 (xem spec §16).
- [ ] Còn mở: finding 4 (hiệu năng băm repo); calibration (M4); trust hook trong Codex.

## Hoàn thiện harness (20/11/2026, theo goal của chủ dự án)

- [x] Sửa finding 1–3 của review M2:
  - lệnh shell chỉ đọc không còn bị lách;
  - Codex chỉ nhận đúng kết quả của role đang chờ;
  - subagent không báo về sẽ hết hạn sau 30 phút, hoặc huỷ bằng `jodex cancel`.
- [x] Sửa finding 4–6 của review M2:
  - sửa blocker qua shell vẫn mở được R1;
  - chỉ quét các run gần đây;
  - phát hiện tester sửa code production.
- [x] Review chéo giữa hai provider là mặc định: Claude làm thì Codex review, và ngược lại. Có lối thoát `--same-host` khi provider kia không dùng được.
- [x] D2 chặn lệnh nguy hiểm: luật cứng, lệnh quen thuộc, rồi mới hỏi Jev (có cache).
- [x] `jodex calibrate`, tự chạy sau mỗi 10 run đóng; log vào `.jodex/calibration.jsonl`; board hiển thị kết quả.
- [x] Không làm D3, D5, D6 (lý do ghi ở spec §17).
- [x] Codex review chéo code harness: 4 vòng R0–R3, 4 vòng sửa F1–F4. Kết quả ở `docs/ai/testing/cross-review/` và spec §17.1.
- [x] Chạy kiểm thật lần cuối cả hai chiều (21/11): Claude làm → Codex review → verified; Codex làm → Claude review → verified.
- **Trạng thái:** harness hoàn thiện trong phạm vi đã chốt. Còn chờ chủ dự án review và chấp nhận.

## DX1 · Inline native TUI (21/11/2026)

User duyệt hướng hiển thị chung trước. Phạm vi: footer native Claude/Codex với Decision/Implementor/Stage/Waiting, read-only transport, setup/docs/test; không watch daemon, không route/provider/permission changes.

- [x] DX1.0 Khảo sát Ponytail (badge/status API) và native host interfaces; chốt inline-first với user.
- [x] DX1.1 Implementer: renderer session-bound + CLI Claude statusline và Codex read-only MCP provider; hook/session metadata bổ sung chỉ khi thiếu dữ liệu thiết yếu; không state machine mới.
- [x] DX1.2 Implementer: native plugin/setup integration giữ statusline cũ, doctor/help/README activation/rollback; không tự thay đổi global thật.
- [x] DX1.3 Tester: meaningful regression gaps, typecheck/full local suite/build, một batch CLI/protocol/setup smoke trên fixture/home cô lập; không gọi provider.
- [x] DX1.4 Reviewer: review current source + actual test output, session isolation, truthful activity, read-only boundaries, config preservation. Tối đa một correction cycle.
- [x] DX1.5 Parent: chốt docs/evidence/current gates. Actual native visual activation cần người dùng bật/select và quan sát; không coi protocol smoke là bằng chứng TUI đã render.

Bước tiếp theo: DX1.1–2, bàn giao implementer → unit_tester → code_reviewer tuần tự. Baseline trước sửa: npm test 67/67, typecheck exit0. AI DevKit lint12 đạt bằng cached CLI; npx --no-install bị thiếu cache package, task CLI không hỗ trợ, checklist này giữ status.

DX1 implementation handoff: implementer đã nhả quyền ghi; parent đã đọc renderer/setup/CLI/manifest/docs. Focused tests4/typecheck/build/diff exit0 trên source hiện tại; full71 trước delta nhãn cuối cần tester chạy lại. Không thay hooks/run schema hoặc dependency. Tiếp theo: tester sở hữu test, production đóng băng.

DX1 tester đã nhả quyền ghi: npm test75/75, typecheck/build/diff exit0; built-CLI smoke5/5. Tester thêm test/statusline-regression.test.ts; source production không đổi, SHA khớp implementation. Actual evidence: `/var/folders/sm/t_3g1b1n3l73b0fjjfylchw00000gn/T/jodex-inline-independent-4gf2byel/results.json`. Bước tiếp theo final read-only review; native visual gate còn mở.

DX1 final: independent reviewer REVIEW_PASS, không có blocker trong scope local. Actual command outputs và current source hashes lưu bền tại [inline-statusline-report.json](../testing/inline-statusline-report.json). Outcome hiện tại **review_required** cho native visual acceptance; không suy ra developer acceptance. Bước tiếp theo: Claude bật `jodex setup --statusline` (giữ footer cũ, compose theo README nếu đã có); Codex refresh plugin, bật Custom status line rồi chọn Jodex. Không chạy setup/global mutation trong lượt coding này. Không có provider calls.
