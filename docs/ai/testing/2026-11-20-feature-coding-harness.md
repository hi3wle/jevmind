---
phase: testing
title: Nghiệm thu theo milestone
---

# Nghiệm thu theo milestone

**Trạng thái hiện tại: M0 và M1 đã có bằng chứng. M2–M4 chưa chạy.** Chi tiết M0 nằm trong `m0-capability-report.json`.

Biên bản nghiệm thu v3.2 (N1, N2/N3, P5, conformance audit) được lưu ở [docs/history/v3.2/testing.md](../../history/v3.2/testing.md). Các report JSON trong thư mục này (`n1-native-report.json`, `n2-n3-native-report.json`, `p5-native-roles-report.json`, `ai-devkit-capability-report.json`) giữ nguyên làm bằng chứng lịch sử. Chúng chứng minh khả năng vận hành của luồng thủ công v3.2 trong fixture. Chúng không chứng minh hành vi của v4.

## Kế hoạch theo milestone

Số row trỏ tới acceptance matrix ở [v4 §13.1](../../../coding-harness-v4.md).

| Milestone | Cách kiểm | Bằng chứng đủ để kết luận |
|---|---|---|
| M0 | Probe từng mục **[verify M0]** trên thư mục tạm. Smoke Jev bằng state tổng hợp, đo latency p50/p95. | `m0-capability-report.json` gồm version, command, exit code và kết luận supported/unsupported/unknown cho từng mục, không chứa secret. |
| M1 | Unit test cho engine, run store và completion precedence. Fixture project để thử setup/init/uninstall trên HOME tạm. Một phiên live cho mỗi host chạy task solo đạt và task có test fail. | Rows 1–6, 17, 19–21. Ghi diff của config trước và sau, status thực tế, và việc Stop hook có chặn hay không. |
| M2 | Port suite snapshot (7 test v3.2 + các case mới). Fixture có defect cài sẵn và fixture sạch, chạy B và C trên mỗi host. Thử write từ planner/reviewer. | Rows 7–12, 18, 22, 24, 25. ReviewResult hợp lệ, snapshot ID khớp, số vòng sửa đúng ngân sách, write bị chặn và có log. |
| M3 | Unit test thresholds và asymmetry bằng response ghi sẵn. Mô phỏng Jev timeout và lỗi. Kiểm payload theo từng data level. Chạy live enforce trên task được duyệt. | Rows 13–16, 23. `decisions.jsonl` ghi mọi quyết định, `actedOn` đúng. Không có quyết định nào nới quá luật cứng. Payload mức 2 không chứa source. Fallback không làm hỏng task. |
| M4 | `calibrate` chạy trên log đã gắn nhãn. Review chéo provider dùng profile đã kiểm. | Đề xuất ngưỡng kèm số liệu từng band; unknown giữ là unknown. Phiên review chéo provider bị giới hạn quyền đúng như profile. |

## Mẫu biên bản

Mỗi đợt nghiệm thu ghi:

- candidate (commit/hash);
- host và version;
- config hiệu lực (không chứa secret);
- fixture hoặc task;
- expected và actual;
- command và exit code;
- tham chiếu bằng chứng;
- kết quả: đạt / trượt / chưa xác minh / ngoài phạm vi;
- gate còn mở;
- người quyết định.

Nếu sửa candidate sau đợt nghiệm thu, chỉ kiểm lại các row bị ảnh hưởng và gắn bằng chứng với bản mới.

## Kiểm tra đã chạy cho bản chuyển đổi tài liệu

Ngày 20/11/2026, trên working tree hiện tại (chưa commit):

- `npx ai-devkit@0.77.0 lint --feature coding-harness`: 12 checks đạt.
- Kiểm link nội bộ trong 23 file Markdown (README, AGENTS, spec v4, `docs/ai`, `docs/history/v3.2`, các skill): 50 link, 0 hỏng.
- `python3 -m unittest discover -s tests -p test_review_snapshot.py`: 7 test đạt. Snapshot helper không đổi; chạy lại để xác nhận nguồn port vẫn xanh.
- `git diff --check`: exit 0.

Chỉ thay đổi tài liệu và link trong skill. Chưa có review độc lập cho bản chuyển đổi này.

## Biên bản M0 ngày 20/11/2026

Candidate là working tree sau commit 2dddaf8, chưa commit. Môi trường: Claude Code 2.1.311, Codex 0.171.0, Node v26.7.0, `@typesafe-ai/sdk` 0.7.0.

Probe chạy trong thư mục scratchpad bên ngoài repo, gồm plugin và hook stub cùng một MCP server stub. Không ghi cấu hình global. Hai run Codex không dùng `--ephemeral` (bắt buộc để spawn được subagent) nên để lại session rollout trong `~/.codex/sessions`.

| Run | Kết quả |
|---|---|
| cc-1 Claude Code (haiku) | exit 0, 20 giây, khoảng 0,012 USD. Đã xác nhận: plugin layout, chèn context khi nhận prompt, chặn ghi bằng PreToolUse, PostToolUse, Stop block, SubagentStop, `agent_id`/`agent_type` trong subagent, giới hạn tool bằng allowlist của agent. |
| cx-1 Codex | exit 0, 35 giây. Hook chèn context, chặn `apply_patch` và Stop block đều chạy. Spawn subagent lỗi khi dùng `--ephemeral`. Gọi MCP lỗi vì cần approval. |
| cx-2 Codex | exit 0, 38 giây. Spawn subagent chạy, có `agent_type` trong hook. MCP chạy sau khi đặt `default_tools_approval_mode="approve"`. Role `sandbox_mode="read-only"` **không** chặn được việc ghi file. |
| cx-3 Codex | exit 0, 27 giây. Đặt sandbox của parent bằng config thay vì cờ CLI: subagent vẫn ghi được file. |
| jev-1 TypeSafe | exit 0, 20 lần gọi, model `jev-1.14.0`. D1 khi đã warm: p50 268 ms, p95 514 ms; lần gọi đầu 1054 ms. Timeout 1 ms báo `APITimeoutError`, key sai báo 401. Câu trả lời D1/D2/D5 trên dữ liệu tổng hợp đều hợp lý. Key không xuất hiện trong output. |

Spec v4 đã sửa theo M0 ở các mục §6.2, §6.6, §8.2, §9.1, §9.2, §9.4 và §10.

Ponytail review của bản thay đổi tài liệu có 5 finding, đã sửa cả 5 trong spec:
1. Stop hook cho dừng khi `stop_hook_active` là true.
2. Hook chỉ đọc trên Codex chặn theo danh sách tool được phép.
3. Che secret trong payload mức 2.
4. Tự dọn snapshot.
5. D5 bỏ qua khi run đang chờ subagent.

Đã thêm acceptance rows 21–25.

`.gitignore` đã thêm `.env` và `.env.*`, vì `.env.local` chứa key mà trước đó chưa bị ignore.

## Biên bản M1 ngày 20/11/2026

Candidate là working tree chưa commit. Môi trường: Node v26.7.0, Claude Code 2.1.311, Codex 0.171.0, TypeScript 7.0.2, esbuild 0.28.2.

| Kiểm tra | Lệnh | Kết quả |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Unit/integration | `npm test` | 17/17 đạt, gồm: thứ tự completion, risk glob, path từ `apply_patch`, identity (file untracked, quyền thực thi, xoá file, `.git` chỉ đọc), check bị stale, hook no-op khi chưa init, prompt chỉ hỏi, task-notification, chặn ghi `.jodex/`, Stop chặn một lần rồi cho qua, sửa qua shell bị bắt nhờ baseline, risk critical, init/uninstall khôi phục đúng nguyên văn file |
| Build | `npm run build` | `plugin/dist/jodex.mjs` khoảng 52 KB |
| Setup cô lập | `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `npm_config_prefix` trỏ vào thư mục tạm; chạy `setup` hai lần, `doctor`, `uninstall` | 6/6 bước ok cả hai lần; doctor thấy plugin ở cả hai host; uninstall gỡ sạch |
| Live Claude Code (haiku, `--plugin-dir`) | project mẫu có bug clamp | Lần 1: script test của fixture lỗi trên Node 26, agent báo `failed_verification` đúng và không sửa `package.json`. Lần 2 (đã sửa fixture): `jodex check` đạt, `Jodex status: verified`, run đóng. Chi phí 0,0044 + 0,0032 USD |
| Live Codex (`-c hooks`, bỏ trust chỉ cho invocation) | cùng project | Lần 1 tìm ra **bug thật**: `jodex check` crash vì sandbox không cho `git add` ghi vào `.git`; agent báo `blocked`, rồi `review_required`, không nhận bừa là xong. Đã sửa identity thành chỉ đọc và thêm test. Lần 2: `jodex check` exit 0, `Jodex status: verified`, run đóng |

Acceptance rows có bằng chứng: 1–4 (row 4 ở mức unit test và live fixture), 6 (unit), 19–21 (unit). Row 5 (thiếu business rule) cần Jev hoặc agent tự hỏi; M1 chỉ dựa vào chỉ dẫn, chưa có bằng chứng riêng. Row 17 (`jodex resume`) mới chạy ở mức CLI. Row 2 (gỡ cài) đã kiểm trong home cô lập, chưa kiểm trên máy thật.

Chưa review độc lập. Status: `review_required`.

## Nghiệm thu thật trên optimize-lab (20/11/2026)

Plugin chạy từ bản cài thật, không dùng `--plugin-dir`. Claude Code dùng cấu hình người dùng thật (haiku). Codex dùng plugin đã cài, với `--dangerously-bypass-hook-trust` cho từng lần chạy vì hook chưa được trust trong TUI.

| Task | Host | Kỳ vọng | Thực tế |
|---|---|---|---|
| T1 sửa `formatCurrency` số âm | Claude Code | verified | verified, run đóng, 0,0051 USD |
| T2 `slugify` gộp dấu gạch | Codex (gpt-6.1-sol) | verified | verified, run đóng |
| T3 sliding session expiry | Claude Code | review_required (critical) | review_required, risk critical |
| T4 câu hỏi về `computeFee` | Claude Code | không có run | không có run |
| T5 loyalty discount | Claude Code | hỏi lại, không đoán | không sửa gì, hỏi 4 câu về business rule |
| T6 phí 3% | Codex | review_required (critical) | review_required, risk critical |
| T7 rename, "đừng chạy lệnh nào" | Claude Code | Stop gate chặn | chặn 1 lần → agent chạy `jodex check` → verified; `stopBlocks` = 1 |

Kiểm tra trên source hiện tại: typecheck sạch, `npm test` 18/18 đạt (thêm test board: escape `</script>`, host/model của Codex, đăng ký/huỷ project), 7 test snapshot Python đạt, `jodex setup` chạy lại 6/6 ok, cache Codex khớp hash với `plugin/`. Ảnh chụp dashboard (sáng và tối) bằng Chrome headless: hiển thị đúng 5 run, 60% verified, 1 gate catch. Lỗi bảng tràn làm cắt pill status đã sửa.

Chưa review độc lập. Status: `review_required`.

## Sửa theo ponytail review của M1 (finding 1 và 2)

1. **Sửa file critical qua shell vẫn được `verified`.** Mỗi prompt giờ đều ghi baseline, và mỗi lần Stop đều gộp các file đã đổi từ baseline vào run, kể cả run do `jodex check` mở với `touched` rỗng.
2. **Run critical không bao giờ đóng.** Khi agent đã báo đúng trạng thái, run đóng dù trạng thái là gì; lần sửa file tiếp theo mở run mới.

Thêm hai test hồi quy. Cả hai **fail trên code cũ** (đã tạm khôi phục logic cũ để kiểm) và đạt trên bản sửa. `npm test` 20/20 đạt, typecheck sạch. Đã build lại, chạy lại `jodex setup` 6/6 ok, cache Codex khớp hash.

Finding 3 (dọn `.jodex/sessions/`), 4 (băm toàn repo nhiều lần) và 5 (log lỗi bỏ qua `JODEX_HOME`) còn mở.

## Jev D1 thật trên optimize-lab (20/11/2026)

Bật `[jev] mode = "enforce"`, `consent = true`, `data_level = 2` trong optimize-lab. Key được nạp qua `jodex key` (đọc từ `.env.local`, không in ra).

| Prompt | Host | Jev (jev-1.14.0) | Hành động | Kết quả |
|---|---|---|---|---|
| Thêm `formatPercent` + test | Claude haiku | solo 1.00, risk elevated 0.64, missing 0.29 | nâng risk lên elevated | verified (review elevated là tuỳ chọn) |
| Loyalty discount | Claude haiku | clarify 0.73, risk critical 0.93, missing 0.85 | yêu cầu hỏi developer, nâng lên critical | agent không sửa gì, hỏi lại |
| README về phí | Claude haiku | solo 0.71, risk low 0.98, missing 0.61 | không | verified |
| Session TTL cấu hình thế nào? | Claude haiku | timeout 1500 ms → fallback | luật cứng | không có run |
| `computeFee` throw TypeError | Codex gpt-6.1-sol | solo 1.00, risk critical 0.69 | nâng lên critical (luật file cũng critical) | review_required |

Latency của Jev: p50 484 ms, p95 835 ms; 1/5 lần bị timeout ở mức 1500 ms. Unit test 26/26 đạt, gồm: chính sách D1 và tính bất đối xứng, che secret, enforce/shadow/fallback với Jev giả, quyết định gắn với run, dọn session, đọc model từ transcript. Ảnh chụp board ở chế độ tối hiển thị đúng 5 quyết định, phân bố xác suất, ngưỡng và kết quả đối chiếu.

## Nghiệm thu M2 (20/11/2026)

Unit/integration test: 35/35 đạt, typecheck sạch. Bộ test team phủ:
- parse ReviewResult và các invariant;
- luồng R0 blocker → F1 → R1 verified;
- chặn ghi của reviewer, gồm cả Bash, MCP và Write;
- worker bị khoá khi đang chờ reviewer;
- Stop không bị chặn khi agent đang chờ subagent;
- bỏ qua agent nội bộ của Claude; output sai được trả lại một lần;
- ngân sách sửa lỗi; review cũ khi source đổi;
- D4 dispute đẩy về developer;
- collaborative: plan trước, revise một lần, rồi accept;
- tester chỉ ghi được file test;
- phạm vi gói review, diff tính từ base của file;
- quy tắc giữ run mở.

Chạy thật trên optimize-lab (working tree còn bẩn với thay đổi từ các task trước):

| Run | Host | Diễn biến | Kết quả |
|---|---|---|---|
| B1 `review:` applyDiscount | Claude haiku | implement → check → `review start` → `jodex:reviewer` → R0 có 4 finding (3 blocker, Jev xác nhận với p 1.00/0.96/0.61) | Lộ ra **lỗi phạm vi**: diff so với HEAD kéo cả thay đổi của task khác. Đã sửa. |
| B2 `review:` subtotal | Claude haiku | R0 có 1 blocker (Jev p 0.97) nói về những dòng trong cùng file nhưng thuộc task trước | Lộ ra lỗi phạm vi bên trong file. Đã sửa bằng `baseFiles`. Agent giữ nguyên thay đổi của developer và hỏi lại, không tự revert. |
| C1 `collab:` cartTotal | Codex gpt-6.1-sol | `plan start` → spawn planner → plan lưu lại → `plan accept` → test trước → implement → check → `review start` → spawn reviewer → R0 không có blocker | `review_required` vì Jev nâng risk lên critical, cần `jodex accept` của developer; run đóng. 122 giây. |

Board (chụp ở chế độ tối) hiển thị đúng 11 run, mode, các vòng review, 8 quyết định D1 và 4 quyết định D4. Calibration: Jev khắt khe hơn luật file trong 4/6 lần; change prediction 6/6.

## Nghiệm thu hoàn thiện: review chéo, D2, calibration (20/11/2026)

Unit/integration test: 47/47 đạt, typecheck sạch. Các phần mới được phủ:
- lệnh chỉ đọc không bị lách (6 lệnh tấn công thật);
- Codex bỏ qua subagent phụ, chỉ nhận đúng reviewer;
- subagent không báo về sẽ hết hạn;
- sửa blocker qua shell vẫn mở được R1;
- phát hiện tester sửa code production qua shell;
- review chéo cả hai chiều với CLI giả;
- D2: luật cứng, lệnh quen thuộc, heredoc, cache theo run;
- calibration: điều kiện đủ mẫu, balanced accuracy, ghi `[jev.thresholds]`, tự chạy sau mỗi 10 run đóng.

| Kiểm tra thật trên optimize-lab | Kết quả |
|---|---|
| Claude làm (haiku), Codex review | `jodex review start` → hook khởi chạy `codex exec --sandbox read-only` → R0 `no_blocking_findings` sau 18 s → verified |
| Codex làm (gpt-6.1-sol), Claude review | `review wait` chạy trong sandbox của Codex; hook khởi chạy Claude Sonnet từ bên ngoài sandbox → 10 s, 0,031 USD, 1 finding không chặn → verified |
| Reviewer chéo hết quota (Codex usage limit) | R0 bị ghi `invalid` kèm thông báo lỗi; trạng thái `review_required`; một run sau đó dùng `--same-host` để có R1 ✓ |
| D2 với `git reset --hard` | bị chặn bằng luật; agent không reset và báo lại cho developer |
| D2 với `curl` (Jev) | safe 0,99, được phép, 344 ms |
| Lỗi tìm ra khi chạy thật | heredoc và subshell bị coi là lệnh lạ, và timeout 800 ms quá ngắn vì Jev luôn cold start trong hook. Đã sửa: nhận diện heredoc, timeout D2 1500 ms, D1 2500 ms |
| `jodex calibrate` (20 run, 28 quyết định) | D1 change Brier 0,0012. D1 risk Brier 0,26: Jev quá tự tin (dải 0,8–1,0 đúng 71%, dải 0,6–0,8 đúng 0%). Ngưỡng chưa dời vì mới có 12/20 mẫu, đúng cơ chế bảo vệ |

Hai lỗi do script chạy thử của tôi, không phải của harness:
- `claude -p` đọc stdin nên nuốt cả danh sách prompt (đã chuyển stdin sang `/dev/null`);
- vì vậy ba run b1, b2, b3 bị nhiễm và đã được `jodex reject`.

## Codex review chéo code harness (21/11/2026)

| Vòng | Thời gian | Kết quả |
|---|---|---|
| R0 | 554 s | 11 blocking, 3 nonblocking. Gồm:<br>• lách bộ lọc lệnh chỉ đọc bằng dấu nháy;<br>• worker ghi qua shell khi đang bị khoá;<br>• agent tự `accept`;<br>• sửa qua shell không có trong diff review;<br>• `jodex check` ghi đè kết quả reviewer;<br>• secret trong lệnh check gửi đi nguyên văn;<br>• Basic auth không bị che;<br>• lệnh check đổi mà bằng chứng cũ vẫn được tính;<br>• Stop chỉ tìm chuỗi con;<br>• blocker bị phản bác có thể bị review mới thay thế. |
| R1 | 428 s | 4 sửa xong, 10 một phần, 3 mới (tester ghi qua shell, D4 ở mức dữ liệu 1, che giá trị secret trong env) |
| R2 | 413 s | 6 một phần, 1 mới (hash không phân biệt symlink với file thường) |
| R3 | 257 s | không có finding mới; 5 một phần, đã sửa ở F4 |

Sau F4:
- `npm test` 67/67 đạt, typecheck sạch;
- kiểm thật hai chiều trên optimize-lab đều `verified`, có R0 từ provider kia;
- chạy kiểm thật còn tìm ra một hồi quy (lệnh `jodex review wait 2>&1; echo` bị chặn khi đang khoá) và đã sửa, kèm test.

Các giới hạn còn lại được ghi ở spec §17.1.

## DX1 · Validation plan (21/11/2026)

Baseline hiện tại: npm test 67/67 exit0; npm run typecheck exit0; AI DevKit feature lint12 exit0. Scope nghiệm thu local: session/project isolation, Jev/rules/fallback/off, unknown/legacy/expired await, role transitions và closed/no-run; control-character/secret-free footer; renderer không ghi state hoặc quét source; Claude command input + Codex MCP initialize/tools/resource/errors; setup existing-config preservation and owned rollback trong home cô lập; build/typecheck/full local suite.

Không gọi provider/Jev/model hoặc tự sửa global thật trong đợt DX này. Kiểm native visual footer là gate riêng: installed Codex feature có nhưng off; user cần /experimental và /statusline selection. Chưa xác nhận footer đã xuất hiện trong TUI thật.

DX1 independent validation: `npm test`75/75 pass exit0; `npm run typecheck`, `npm run build`, `git diff --check` exit0. Built entrypoint smoke5/5 pass: explicit Claude install/remove config, synthetic observed Jev/wait role, MCP discovery/thread switch/error recovery, unchanged run+decision bytes. Test additions: test/statusline.test.ts4 initial TDD + test/statusline-regression.test.ts4 independent regressions; controls, secrets, malformed/linked settings, backup/modes, current vs other session covered. Actual command stdout/stderr/exit+source hashes: `/var/folders/sm/t_3g1b1n3l73b0fjjfylchw00000gn/T/jodex-inline-independent-4gf2byel/results.json`; parent đã đọc actual outputs. Không gọi provider/Jev hoặc thay global. Chờ final reviewer; native rendered footer chưa được quan sát.

DX1 final reviewer đã đọc actual outputs và before/after source, xác nhận 8 hashes hiện hành và REVIEW_PASS không blocker cho scope local. Bằng chứng bền: [inline-statusline-report.json](inline-statusline-report.json), gồm actual stdout/stderr/exit, source hashes, no-provider/global-change flags và gates. Smoke script dùng một lần đã tự dọn sandbox; script được xoá sau review, regression tests được giữ. **Native visual activation chưa kiểm**: không coi JSON/protocol smoke là bằng chứng đã render trong TUI. Current outcome review_required cho gate đó; developer acceptance tách riêng.

DX1 native registration failure: actual global effective Jodex transport had command=node, args=['${PLUGIN_ROOT}/dist/jodex.mjs','statusline','--mcp']; launching that argv exits1 MODULE_NOT_FOUND. User had enabled plugin and experimental flag. Isolated native reproduction at `/var/folders/sm/t_3g1b1n3l73b0fjjfylchw00000gn/T/jodex-native-registration-ftp0kzxv` confirms installed0.171.0 leaves both root placeholders literal. No provider calls. Existing local75/protocol5 evidence remains historical for direct entrypoint, not proof of native plugin startup; native registration fix and evidence now required.

F1 final evidence: native isolated before/after reproduction đạt; full77/typecheck/build/diff exit0 và reviewer REVIEW_PASS. Parent refresh riêng actual Jodex plugin rồi đọc actual native app-server mcpServerStatus/list (per-invocation configured MCP map rỗng, không persist): toolsError=null, tool jodex_statusline có đúng openai/ui statusline resource. Không tạo model turn/provider call. Durable actual outputs, current hashes và actual-machine discovery ở [native-statusline-registration-report.json](native-statusline-registration-report.json). F1 đã sửa launcher; user cần restart TUI cũ và chọn Jodex. Actual rendering/visual acceptance vẫn chưa quan sát.
