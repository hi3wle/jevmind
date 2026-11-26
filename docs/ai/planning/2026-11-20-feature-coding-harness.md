---
phase: planning
title: Kế hoạch triển khai và trạng thái
---

# Kế hoạch triển khai và trạng thái

## Đổi tên Jevmind và phát hành 0.1.0 (24/11/2026)

Developer chọn tên Jevmind (Jev chấm điểm các tên), cắt hẳn khỏi Jodex, license MIT, developer tự `npm publish`.

- [x] Đổi tên trong mã, plugin, test và tài liệu hiện hành; lịch sử (v3.2, docs/history, bằng chứng docs/ai/testing) giữ nguyên.
- [x] `jevmind init` chuyển một project từ `.jodex/` sang `.jevmind/` trong một thay đổi có xác nhận.
- [ ] Developer: gỡ Jodex, `mv ~/.jodex ~/.jevmind`, `jevmind setup`, trust hook Codex, `/reload-plugins`, `jevmind init` trong repo này, đổi tên repo GitHub.
- [ ] Developer: `npm publish` theo checklist trong CHANGELOG/README, gắn tag v0.1.0.

## Bản beta qua Git clone

- [x] Developer duyệt apply cho dự án mới. Init giải thích cách dùng off trước khi xác nhận và giữ nguyên config đã có.

- [x] Routing: developer đã accept run 20261121-aed583. Board: R1 không còn blocker và run 20261121-37731a verified.
- [x] Chuẩn hóa hướng dẫn clone/build từ lockfile, tách hướng dẫn footer, loại log calibration khỏi file đưa vào Git và dừng setup nếu npm link lỗi.
- [ ] Kiểm tra và review bản ứng viên, tạo commit, kiểm clone sạch trên commit đó. Developer thực hiện các bước cài/gỡ dành riêng cho chủ máy. Chỉ publish sau khi có quyết định phát hành.

Các mục bên dưới là lịch sử theo từng đợt bàn giao.

## BW · Board workflow live (21/11/2026)

User xác nhận workflow như GitHub Actions và yêu cầu dùng task này kiểm thử thật. Plan native Astra high đã được worker challenge/accept: run 20261121-37731a, plan-0.md. Tiếp tục Mode A đã duyệt trong phiên; không dùng implementation child vì hook đã chứng minh helper không được sửa production. Native model requests ở lượt này được chọn tường minh theo bảng user đã duyệt; không coi đó là bằng chứng `[models] apply` đã bật. Chỉ dẫn cấp cao vẫn cấm sửa managed .jevmind dù user cho phép; activation config còn cần developer.

- [x] BW1 Parent: thay grid7 bằng ordered4 role nodes có connector/status/model requested vs observed, activity/gates riêng; giữ SSE/poll/filter; focus keyboard và narrow layout; không dependency. src/board.ts thêm read-only activity projection và chặn current role cho run đã đóng.
- [x] BW2 Tester Luna high: affected49/49 và full148 JS/Python7/typecheck/build đạt trước delta CSS width cuối. Parent quan sát actual planner→implementor→tester handoffs, desktop và iPhone393px, Space toggle qua live refresh; CSS min-width/grid đã sửa theo quan sát mobile. Tester kiểm lại snapshot cuối; evidence current ở packet Jevmind. Không seed run giả.
- [x] BW3 Reviewer đọc snapshot cuối + actual evidence; một correction cycle; developer acceptance riêng. Kết quả/Next hiện hành ở `jevmind status` run 37731a để không sửa docs sau review và làm stale snapshot. Kết quả: R1 no_blocking_findings, run 37731a verified.

Allowed scope: plugin/board.html, src/board.ts, test/board.test.ts và board regression fixtures, README, feature implementation/testing/planning. Các thay đổi từ task routing trước phải giữ nguyên. Parent mở server mới 4318 cho board đã build, không dừng server 4317 đang có. Bước tiếp theo BW2, rồi BW3. Chưa claim auto model routing hoặc model observed khi hook không cung cấp.

## MR launch routing · 21/11/2026

Developer đã duyệt bảng routing và xác nhận áp dụng khi launch planner/tester trong phiên tiếp tục: planner Claude Opus / Codex Astra high; tester Codex Luna high ở mọi risk, Claude Haiku thường và Sonnet khi critical. Giữ nguyên implementor và reviewer. Giữ off/shadow tương thích; apply chỉ áp dụng planner/tester, không mở rộng reviewer hoặc tự bật cấu hình managed. Model requested tách observed; host không hỗ trợ phải báo giới hạn, không giả đã chạy model.

- [x] LR1 implementer rồi parent Mode A (developer duyệt): routing/launch/warning/docs đã sửa; RED3 trước routing, RED2→GREEN2 cho blank model/nullable effort. Native model handoff giữ observed unknown. Implementation child đã nhả quyền ghi; parent đóng băng production cho tester.
- [x] LR2 unit_tester: tests đã bàn giao; 146/146 JS, Python7, typecheck/build exit0. Parent chạy built-CLI smoke 36/36 trong temp/home cô lập (off/shadow/apply × host × risk × role); không gọi provider. Production/test đóng băng cho review.
- [x] LR3 review/human acceptance: R0 independent Codex reviewer phát hiện risk stale khi shell sửa critical trước tester; parent Mode A xác nhận RED→GREEN và thêm reconcileSession ở startTests. Một correction cycle đã dùng. Tester kiểm lại rồi reviewer R1 trên snapshot cuối; kết quả và Next hiện hành được Jevmind ghi tại run 20261121-aed583 (`jevmind status`), human acceptance riêng vẫn cần developer. Kết quả: R2 no_blocking_findings, developer đã accept run aed583.

Allowed files: src/config.ts, src/team.ts, src/cli.ts (warning), src/run.ts (chỉ warning nếu cần), test/model-routing.test.ts và test routing liên quan, coding-harness-v4.md, README.md và docs/ai/{implementation,testing}/2026-11-20-feature-coding-harness.md. Không sửa .jevmind/, không commit/push/global setup hoặc gọi provider ngoài review bắt buộc đã được chỉ định. Parent giữ planning. Bước tiếp theo LR3; các delta có sẵn thuộc phiên trước phải được bảo toàn.

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
- Đã cài thật (`jevmind setup`) trên máy chủ dự án. Đã có repo thử `optimize-lab` và dashboard `jevmind board`.
- **Bước tiếp theo:** chủ dự án trust hook Jevmind trong Codex (`/hooks`), review M1, rồi M2.

## Milestones

| ID | Phụ thuộc / phụ trách | Việc và đầu ra | Goal / bằng chứng | Trạng thái |
|---|---|---|---|---|
| V4.0 | — / chủ dự án + Claude | Review v3.2, chốt hướng v4, viết spec, chuyển tài liệu | requirements, design | Hoàn tất |
| M0 | V4.0 / implementer + unit_tester | Kiểm từng mục **[verify M0]** trên Claude Code và Codex đang cài; smoke Jev SDK và đo latency; ghi capability matrix; sửa spec ở chỗ giả định sai | G0–G5 (tiền đề) / `testing/m0-capability-report.json` | Hoàn tất ngày 20/11/2026; xem testing |
| M1 | M0 / implementer → unit_tester → code_reviewer | Scaffold TypeScript; CLI `setup`/`init`/`doctor`/`status`/`resume`/`uninstall`; MCP server; run store; rules engine; Mode A; completion gate; adapter Claude Code; Codex ở instruction mode (hoặc hook nếu M0 xác nhận) | G0–G3 / rows 1–6, 17, 19–21 | Đã triển khai, test và chạy live; chờ chủ dự án review và cài thật |
| M2 | M1 | Port snapshot; role planner/tester/reviewer; writer lock; `jevmind_submit_plan`/`challenge`/`review`; R0→F1→R1; Mode B/C trên cả hai host | G3–G4 / rows 7–12, 18, 22, 24, 25 | Chưa bắt đầu |
| M3 | M1 (D1, D5); M2 (D4) | Engine Jev: D1–D5 enforce mặc định; `decisions.jsonl`; consent và data level (mặc định 2) trong `init`; timeout/fallback | G5 / rows 13–16, 23 | Chưa bắt đầu |
| M4 | M3 + đủ quyết định đã gắn nhãn | `jevmind calibrate`, `accept`/`reject`; D6 định tuyến model; review chéo provider | G6 | Chưa bắt đầu |
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
- Chưa có MCP server ở M1. Bằng chứng kiểm tra đi qua `jevmind check`.
- Identity chuyển sang băm nội dung file trong process, vì sandbox của Codex không cho ghi vào `.git`.

Còn mở:
- Chưa chạy `jevmind setup` trên cấu hình thật của chủ dự án; mới kiểm trong home cô lập.
- Trust hook Codex qua `/hooks` cần người làm trong TUI.
- Run critical luôn ở `review_required` cho tới M2.

## M1 mở rộng: cài thật, optimize-lab, dashboard (20/11/2026)

- [x] `jevmind setup` trên cấu hình thật: npm link vào `/opt/homebrew/bin/jevmind`, plugin `jevmind@jevmind` đã cài vào Claude Code (đọc trực tiếp từ `plugin/`) và Codex (bản sao trong cache, chạy lại `setup` để làm mới).
- [x] Repo thử `/Volumes/WD-EXTERNAL/Personal/optimize-lab`: backend shop nhỏ, `TASKS.md` gồm T1–T6, đã `jevmind init`.
- [x] `jevmind board`: dashboard HTML tại chỗ, kiểu ponytail. Có danh sách project, KPI, biểu đồ theo trạng thái/thời gian/số file, bảng run, outcome và risk, heatmap. Có giao diện sáng/tối.
- [x] Run ghi thêm `host`, `model` (Codex) và `stopBlocks`.
- [ ] Trust hook Jevmind trong Codex TUI (`/hooks`): chủ dự án làm.

## Sửa finding 3, 5 và đưa Jev D1 lên trước M2 (20/11/2026)

- [x] Finding 3: xoá file session khi agent dừng; xoá các file cũ hơn 7 ngày khi có prompt mới.
- [x] Finding 5: log lỗi hook nằm dưới `JEVMIND_HOME`.
- [x] Board hiển thị model của từng run: Codex lấy từ hook, Claude Code đọc từ transcript. Kèm chip phiên bản Jev và nhãn "raised by Jev".
- [x] **Jev D1 được đưa lên trước M2 theo yêu cầu chủ dự án.** Gồm: 4 câu hỏi lúc nhận prompt, chính sách ngưỡng chỉ được siết, che secret, `decisions.jsonl`, `jevmind key`, `jevmind init --jev`, khu "How Jev decides" và các ô calibration trên board.
- [ ] M2 (team modes) tiếp theo; D4 (phân loại finding) sẽ đi cùng M2.
- Finding 4 (băm toàn repo nhiều lần mỗi lượt) vẫn mở.

## M2 team modes (20/11/2026)

- [x] Role prompts `plugin/agents/{planner,reviewer,tester}.md`, dùng chung cho cả hai host.
- [x] Các lệnh `jevmind plan|test|review start`, `jevmind plan accept|revise|block`, và dòng `Next:` trong output.
- [x] Kết quả role lấy qua `SubagentStop`. Kiểm tra ReviewResult và các invariant; output sai được trả lại một lần.
- [x] Quyền theo stage: planner và reviewer chỉ đọc; tester chỉ ghi file test; worker bị khoá khi đang chờ subagent; collaborative phải có plan được chấp nhận trước khi sửa.
- [x] Ngân sách sửa lỗi R0→F1→R1; review bị coi là cũ khi source đổi; D4 qua Jev.
- [x] Gói review đúng phạm vi run (base của từng file); run chỉ đóng khi bước tiếp theo thuộc về developer; prompt mới được nhắc về run còn dang dở; `jevmind accept` thoả review bắt buộc của người.
- [x] Board hiển thị mode, các vòng review, số plan, và khu D4.
- [ ] MCP server: không cần cho M2 (xem spec §16).
- [ ] Còn mở: finding 4 (hiệu năng băm repo); calibration (M4); trust hook trong Codex.

## Hoàn thiện harness (20/11/2026, theo goal của chủ dự án)

- [x] Sửa finding 1–3 của review M2:
  - lệnh shell chỉ đọc không còn bị lách;
  - Codex chỉ nhận đúng kết quả của role đang chờ;
  - subagent không báo về sẽ hết hạn sau 30 phút, hoặc huỷ bằng `jevmind cancel`.
- [x] Sửa finding 4–6 của review M2:
  - sửa blocker qua shell vẫn mở được R1;
  - chỉ quét các run gần đây;
  - phát hiện tester sửa code production.
- [x] Review chéo giữa hai provider là mặc định: Claude làm thì Codex review, và ngược lại. Có lối thoát `--same-host` khi provider kia không dùng được.
- [x] D2 chặn lệnh nguy hiểm: luật cứng, lệnh quen thuộc, rồi mới hỏi Jev (có cache).
- [x] `jevmind calibrate`, tự chạy sau mỗi 10 run đóng; log vào `.jevmind/calibration.jsonl`; board hiển thị kết quả.
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

DX1 tester đã nhả quyền ghi: npm test75/75, typecheck/build/diff exit0; built-CLI smoke5/5. Tester thêm test/statusline-regression.test.ts; source production không đổi, SHA khớp implementation. Actual evidence: `/var/folders/sm/t_3g1b1n3l73b0fjjfylchw00000gn/T/jevmind-inline-independent-4gf2byel/results.json`. Bước tiếp theo final read-only review; native visual gate còn mở.

DX1 final: independent reviewer REVIEW_PASS, không có blocker trong scope local. Actual command outputs và current source hashes lưu bền tại [inline-statusline-report.json](../testing/inline-statusline-report.json). Outcome hiện tại **review_required** cho native visual acceptance; không suy ra developer acceptance. Bước tiếp theo: Claude bật `jevmind setup --statusline` (giữ footer cũ, compose theo README nếu đã có); Codex refresh plugin, bật Custom status line rồi chọn Jevmind. Không chạy setup/global mutation trong lượt coding này. Không có provider calls.

## DX1 F1 · Native Codex provider missing (21/11/2026)

User screenshot: /statusline provider picker only Default. Repro: installed plugin enabled + tui_extensions_statusline=true, but installed Codex0.171.0 exposes literal `${PLUGIN_ROOT}/dist/jevmind.mjs` in effective MCP transport. Isolated CODEX_HOME local marketplace reproduces both PLUGIN_ROOT and CLAUDE_PLUGIN_ROOT not expanded. Direct launch exits1 MODULE_NOT_FOUND. Initial direct CLI/protocol smoke missed native plugin loading; native visual gate was correctly left open, but launcher registration is a confirmed defect.

Approved inline-first scope authorizes this focused correction. Fix: use the installed `jevmind statusline --mcp` command in Codex-only manifest, since normal setup links jevmind onto PATH before installing plugin. Preserve other source/config edits. No new engine/global MCP config or dependency. Validate exact declared transport plus real Codex plugin install/discovery in isolated CODEX_HOME; refresh only Jevmind plugin on actual machine after checks. No model/provider calls or unrelated config reads/changes.

- [x] F1.1 Same implementer: minimal launcher fix + regression RED/GREEN, README path/cache note.
- [x] F1.2 Tester: actual native isolated plugin registration/transport startup/discovery, full local checks once; preserve raw evidence, no paid calls.
- [x] F1.3 Reviewer: current launcher/delta and actual native evidence, then parent refresh Jevmind plugin and verify actual machine resolved transport/provider discovery.
- [ ] F1.4 User reopens /statusline; visual acceptance remains separate.

Ownership sequential implementer → tester → reviewer. This is the one default correction cycle for the confirmed DX1 production defect.

F1 implementer handoff: manifest command=jevmind, args=statusline --mcp; exact declared-transport regression RED MODULE_NOT_FOUND → GREEN tools/list. Parent inspected source; tester owns tests/native isolated acceptance next. No src/runtime logic change.

F1 native independent check: old descriptor really fails native handshake; same-version plugin add refreshes cache, fixed descriptor native tools/list discovery succeeds. Full77/typecheck/build/diff pass. Durable raw outputs in native-statusline-registration-report.json. Tester released ownership; final reviewer next.

F1 final: REVIEW_PASS. Parent đã refresh riêng `jevmind@jevmind` trên máy thật (native plugin add exit0), effective transport là jevmind statusline --mcp; actual app-server discovery trả serverInfo=jevmind-statusline, toolsError=null và đúng UI entrypoint. Không tạo model turn hoặc thay cấu hình provider/plugin khác. Native visual gate F1.4 còn mở: đóng/mở lại Codex hiện tại, /statusline chọn Jevmind. Outcome review_required chỉ cho gate hiển thị/nghiệm thu của user.

## MR · Model routing P0+P1 (21/11/2026)

Plan đã accept: `.jevmind/runs/20261121-4a4019/plan-1.md` (Jevmind planner, sau hai vòng phản biện của Codex gpt-6.2-astra high). Phương án routing đã chốt: thang L0 haiku/luna high (chỉ thử nghiệm cho tester), L1 sonnet/sol high (mặc định mọi role), L2 opus/astra high (risk critical). Không leo thang tự động, không tăng bậc theo diff size hay risk elevated. `[models] mode = off|shadow|apply`, thiếu section = off. P1 chỉ ghi attribution trung thực; P2 (reviewer apply + kiểm catalog), P3 (same-host apply), P4 (fixture có lỗi cài sẵn) là follow-up.

Sửa đổi so với plan-1 (developer chốt sau khi hết revision budget, thay thế các mục tương ứng trong plan-1):
- **P0c thay thế:** bỏ allow-list `codex exec`/`claude -p` do worker gõ và bộ tokenizer shell. Thay bằng lệnh `jevmind review plan`: Jevmind tự chạy cross reviewer trên `plan-N.md` mới nhất với profile read-only đã test trong `src/crossreview.ts` `command()`, ghi kết quả cạnh plan, theo `[review] cross_provider` (tắt hoặc thiếu CLI kia thì in lý do và không làm gì). Đây là lệnh jevmind, đã được phép khi đang khoá.
- **A:** nhóm shell tự do khi mở run lazy chỉ gồm `isReadOnlyCommand`, lệnh jevmind (`allowedWhileLocked`), và mục test/build của ROUTINE. `touch`, `mkdir`, `git add|commit|switch`, `node -e`, `make` và các routine ghi file khác mở run và bị khoá.
- **B:** trên POSIX, realpath của `/tmp` cũng là thư mục tạm, cùng với `os.tmpdir()` và `$TMPDIR`.
- **C:** subagent phụ được ghi vào thư mục tạm; giới hạn tester/reviewer/planner giữ nguyên.
- **D:** giải quyết bằng P0c mới (theo `cross_provider`).
- **E:** sửa lỗi đã tái hiện hai lần trong run 20261121-4a4019: SubagentStop đầu tiên của `jevmind:planner` chạy nền không ghi nhận plan, chỉ lần gửi lại giống hệt mới được ghi. Tìm nguyên nhân trong `onSubagentStop`/`recordSubagent`, sửa kèm test.

Astra vòng 3 (gpt-6.2-astra high, read-only), parent đã đối chiếu source; bổ sung bắt buộc:
- **R3.1 (P0a):** lần ghi đầu tiên tạo run solo, `attach` nâng lên collaborative trong bộ nhớ rồi deny mà không lưu (`src/run.ts:150`, `src/hooks.ts:215`). Phải `saveRun` mode đã nâng trước khi deny. Test: Write bị deny, sau đó một lệnh shell không tự do ở hook invocation mới vẫn bị khoá.
- **R3.2 (P0c):** `WORKFLOW` chỉ có `review start|wait` (`src/hooks.ts:48`). Thêm ngoại lệ riêng cho worker khi plan đang chờ: `jevmind review plan` được phép; subagent phụ vẫn bị chặn (dòng 203 không nới). Kết quả gắn với đúng revision của plan, không đổi decision của plan, không tiêu tốn round code review. Codex: launch qua hook ngoài sandbox như reviewer hiện tại. Test hai chiều provider, helper bị chặn, cross review tắt hoặc thiếu CLI thì không làm gì.
- **R3.3 (P1e):** subagent Codex không có kiểu nhận role từ `awaiting` (`src/hooks.ts:180`), nên helper đến trước có thể bị ghi là tester. Giữ nguyên cách nhận kết quả role; attribution của child không có bằng chứng độc lập (không `agent_type` `jevmind:<role>`) để `unknown`. Test helper đến **trước** child thật.
- **R3.4:** `plan start` khi chưa có run tạo run với request rỗng, host null (`src/cli.ts:147`), `crossHost(null)` chọn Codex. Gắn session đang gọi (reconcile) trước khi dựng brief hoặc chọn provider.
- **R3.5 (E, nguyên nhân):** planner giao `# Plan` qua `SubagentHandback.message`; `onSubagentStop` chỉ đọc `last_assistant_message` (`src/hooks.ts:290`), lần retry rỗng có thể xoá `awaiting` mà không lưu plan. Lấy handback của đúng child; test giao lần đầu, giao trùng, retry rỗng.
- **R3.6 (B/C):** không resolve symlink ở phần tử cuối: xoá/di chuyển một symlink trong repo trỏ vào `/tmp` vẫn là thao tác trong repo. Chỉ resolve thư mục cha. Test link trong repo trỏ vào `/tmp`.
- **R3.7 (P1d):** bỏ fallback `latestReview` cho worker không có round: worker cũ không có round thì không làm gì (chạy lại bằng `jevmind review wait`). Test worker R0 không round đến sau khi R1 bắt đầu.
- **R3.8 (test):** `git log` không thuộc nhóm tự do theo A; test `jevmind plan start` tách khỏi case Stop của câu hỏi; case non-temp không dùng `JEVMIND_HOME` của helper (nằm trong temp).

- [x] MR.1 Implementer: P0-pre, P0a, P0b, P0c mới, E, R3.1–R3.6.
- [x] MR.2 Implementer: P1a–P1g (attempt record, config `[models]`, round binding, observation, board, docs, build).
- [x] MR.3 Tester: test theo plan-1 §6 + A–E; `npm test`, typecheck, python unittest, build, `jevmind check`.
- [x] MR.4 Reviewer chéo (critical paths), tối đa một correction cycle; developer acceptance. Run 20261121-4a4019: R0 blocker (`&` đơn) đã sửa; R1 blocker (lint/`--fix` trong nhóm tự do) hết budget, chuyển sang run 20261121-68d96b. Run 68d96b: R0 blocker (flag trong dấu nháy) đã sửa; R1 insufficient_evidence vì tài liệu này chưa cập nhật. Chờ review lại và developer `accept` cho cả hai run. Kết quả: developer đã accept cả hai run; các blocker còn lại được sửa ở run RC sau (71104c, 0ba7cc…).
- [x] MR.5 Live checks trên optimize-lab (developer đồng ý gửi source optimize-lab cho Claude và Codex): hai chiều review, hook Codex, nested reviewer tắt hook, effort trong banner Codex. Model của child Codex: không áp dụng (child Codex không có kiểu, luôn unknown theo R3.3; có unit test). Kết quả ở mục MR của tài liệu testing.

**Token metrics và so sánh phiên (run 20261121-68d96b, plan-0 đã accept):** developer chốt: metric nằm trong Jevmind board; ít blocker hơn là tốt hơn; token so sánh = input + output + cache write (cache read hiện riêng); token Jev hiện riêng; "đạt" = verified hoặc accepted trên run đã kết thúc. Live MR.5 phát hiện và sửa thêm (developer đồng ý từng mục): CLI chọn run theo phiên đang chạy, bỏ qua session file quá 30 phút; R4: giữ `promptAt` cho run do CLI tạo và worker reviewer nền không qua chọn run; hook Codex dùng `jevmind hook` từ PATH (run 20261121-467bc4).

- [x] MR.6 Developer accept các run 20261121-4a4019, 20261121-68d96b, 20261121-467bc4.

## RC · Sửa triệt để sau retrospective (21/11/2026, run 20261121-74b7d2)

Plan đã accept: `.jevmind/runs/20261121-74b7d2/plan-0.md`. Bỏ bước 5 (miễn trừ heredoc cho dev-only deny) và bước 8 (kiểm hash trust, chưa xác minh được). Ngoài phạm vi, chờ developer chốt quy tắc: session id tường minh cho CLI (Codex có `CODEX_SESSION_ID`), đóng run cũ khi có task mới. Quy ước làm việc đã ghi vào memory.

- [x] RC.1 Cổng lệnh: che phần trong dấu nháy, cho phép `/dev/null`, `sed -n N[,M]p`; nhóm tự do = đúng các lệnh `[checks]` (bỏ regex TEST_BUILD và blacklist flag).
- [x] RC.2 Brief reviewer: gate live và bằng chứng chỉ developer có không phải lý do `insufficient_evidence`.
- [x] RC.3 `jevmind doctor`: hooks file trong cache so với nguồn, trust đủ mọi event Codex.
- [x] RC.4 Không launch reviewer trong sandbox Codex (`CODEX_SANDBOX`, đã kiểm live).
- [x] RC.5 Tester một đợt: 129/129, typecheck, python.
- [x] RC.6 Review chéo (run 74b7d2 R0 2 blocker, R1 1 blocker ANSI-C → sửa ở run 20261121-b49ca1, R0 no_blocking_findings); developer accept 74b7d2 và b49ca1 (b49ca1 verified). Còn việc của developer: thêm `build = "npm run build"` vào `[checks]` của `.jevmind/config.toml`; chốt session id tường minh cho CLI và việc đóng run cũ khi có task mới.

Trạng thái hiện tại: review_required. Bước tiếp theo: review chéo run 20261121-68d96b trên source hiện tại, sau đó developer accept. Bằng chứng kiểm thử ở mục MR của tài liệu testing.
