---
phase: planning
title: Kế hoạch triển khai và trạng thái
---

# Kế hoạch triển khai và trạng thái

Đây là backlog chính của feature. Maintainer cập nhật trạng thái ngay trên dòng công việc khi bàn giao. “Đã chuẩn bị” nghĩa là artifact sẵn sàng cho đợt nghiệm thu. “Đạt” cần có kết quả ở testing. **H1 CLI đã bàn giao. P3/H2 local đã hoàn tất, final REVIEW_PASS; chưa gọi Claude. Correction sau đối chiếu proposal đã qua tester và final REVIEW_PASS: actual test-output review đã bổ sung, AI DevKit audit/manifest đã sửa. V1 vẫn hoãn, B/C experimental.**

| ID | Phụ thuộc / phụ trách | Việc và đầu ra để bàn giao | Goal / bằng chứng | Trạng thái |
|---|---|---|---|---|
| P0 | Codex | Review proposal, tạo feature AI DevKit, ghi goals, backlog và kế hoạch nghiệm thu | G0 / năm tài liệu feature | Hoàn tất |
| P1 · H0 | P0 / maintainer + Codex | Chọn repo mẫu được phép, task thường và bug, lệnh kiểm tra, human review, dữ liệu/provider được phép. Ghi phiên bản, auth/billing đã che thông tin nhạy cảm, rule thực nạp, khả năng session, cấu hình hiệu lực và các ô chưa biết vào implementation. Chốt diff tối thiểu và ước lượng sau kiểm kê. | G0 / ma trận và tiêu chí task | Hoàn tất trong phạm vi CLI đã kiểm |
| P2 · H1 | P1 / Codex | Dùng entry native, thêm phần policy thiếu cho solo, risk và quyết định trọng yếu. Ghi cách vào mode, cách resume, xử lý developer edit, kết quả check và manual rollback. Chuẩn bị task mẫu và cấu hình tốt trước đó cho N1. | G1–G2 / N1 | Hoàn tất trong phạm vi CLI đã kiểm |
| P3 · H2 | P2 và có phạm vi dữ liệu B / Codex | Chọn phương pháp capture, materialize và đối chiếu snapshot. Chuẩn bị reviewer prompt, contract finding, evidence v2, stale check, giới hạn R0–F1–R1 và fixture cho N2. | G3 / N2 | Hoàn tất fixture scope, final REVIEW_PASS; B thử nghiệm |
| P4 · H3 | P3 và có task cần chọn thiết kế, đã cho phép C / Codex | Dùng một plan AI DevKit có revision, challenge từ cùng worker, một lần revise mặc định và fresh review. Chuẩn bị phương án resume hoặc bàn giao thủ công cho N3. | G4 / N3 | Hoàn tất fixture scope, final REVIEW_PASS; C thử nghiệm |
| P5 · nghiệm thu | P2 + các hạng mục tùy chọn đã chuẩn bị / maintainer + người kiểm thử | Chốt candidate, chạy một đợt theo testing, ghi từng gate và quyết định bàn giao. Nếu chỉ giao H1, N1 đủ cho phạm vi này. | G0–G4 theo phạm vi / N1–N3 | Hoàn tất H1 và N2/N3 fixture scope, final REVIEW_PASS; giới hạn ghi trong testing |
| P6 · quyết định giữ B/C | N2 đạt cho B, N3 đạt cho C / chủ dự án + người chấm độc lập | Chốt ngân sách và ngưỡng trước lượt đo, chạy V1 khi được phép, quyết định giữ, sửa hoặc hoãn theo nhóm task. | G5 / báo cáo pilot | Hoãn theo lựa chọn người dùng; B/C chỉ thử nghiệm |

**H4.** Chỉ mở một plan mới cho Jev ASSESS khi đánh giá độc lập chứng minh lợi ích vượt cả quy tắc cố định lẫn quy tắc kết hợp suy luận native. Acceptance gồm tư vấn hợp lệ, biết từ chối khi thiếu dữ liệu, fallback khi timeout và giữ nguyên quyền quyết định của developer.

**H5.** Chỉ mở khi có nhu cầu tự động kích hoạt release và có publisher đáng tin cậy. Acceptance gồm ghim cấu hình theo phiên hoặc chỉ đổi lúc idle, nhận biết candidate lỗi thời và khôi phục cấu hình trước mà bảo toàn task đang chạy.

**Quy tắc điều phối.** Khi xong một hạng mục, Codex ghi artifact và hạng mục kế tiếp tại đây. Maintainer ghi kết quả nghiệm thu vào testing. Việc tùy chọn chưa đủ điều kiện giữ trạng thái riêng để H1 vẫn có thể bàn giao.

## Cấu hình subagent theo yêu cầu bổ sung

- [x] Sao chép .codex/config.toml và ba role, giữ model/effort từ repo nguồn.
- [x] Điều chỉnh AGENTS.md và README cho workflow tuần tự và bàn giao quyền ghi.
- [x] Kiểm tra TOML, tên role, đường dẫn config và chỉ dẫn không spawn lồng.
- [x] P5 đã chạy native fixture ba role theo thứ tự, xác nhận discovery và final model contexts Sol/Terra/Sol medium. Evidence tại testing/p5-native-roles-report.json. Filesystem probe kiểm riêng named profile; strict reviewer read-only và full MCP stack vẫn chưa xác minh.

Goal đã được người dùng resume. Bàn giao tuần tự implementer → unit_tester → code_reviewer hoàn tất. Blocker entry đã sửa, final review đạt trong scope CLI. Planning giữ trạng thái và testing giữ bằng chứng.

## P3/H2 local được chọn triển khai

Người dùng chọn “Chỉ chuẩn bị local, chưa gọi Claude”. Không cài Claude CLI hoặc gửi source ra provider. Dùng implementer → unit_tester → code_reviewer theo cấu hình project. Hợp đồng review giữ dạng prompt/template; không làm launcher hoặc provider abstraction.

- [x] P3.1 implementer chuẩn bị capture/materialize/verify snapshot cho ordinary Git repo, giữ real index, bao phủ tracked changes và approved untracked paths.
- [x] P3.2 implementer chuẩn bị skill/prompt, result template và hướng dẫn handoff/fix/re-review.
- [x] P3.3 unit_tester chạy một batch fixture local cho fidelity, stale/tamper/unsupported layouts, index preservation và CLI entry.
- [x] P3.4 code_reviewer kiểm implementation và bằng chứng local, sửa một vòng nếu có blocker.
- [x] P3.5 ghi trạng thái local-ready, các điều kiện live N2 và V1 còn mở.

Acceptance local gồm capture có baseline/tree rõ ràng, snapshot đọc được và khớp source được duyệt, gồm file mới/xóa/mode; real index không đổi; verify từ chối bản bị sửa hoặc current source thay đổi. Các layout chưa hỗ trợ bị từ chối rõ ràng. Handoff giữ original goal/test evidence, review gắn snapshot và đúng invariants; F1 tiêu thụ một lượt sửa. N2 runtime và lợi ích Mode B vẫn cần Claude/quyền dữ liệu/pilot riêng.

## Kết quả P3 local

Implementer → unit_tester → code_reviewer đã hoàn tất tuần tự. Suite CLI local 7 test đạt; reviewer kiểm thêm failure sau materialization bắt đầu, cleanup giữ nguyên index/source. Final REVIEW_PASS chỉ cho local preparation. N2 live và pilot V1 chưa chạy theo lựa chọn người dùng. P4 chưa mở; H4/H5 tiếp tục deferred. Các file hiện ở working tree, chưa commit release.

## P4 local và các gate hoàn thiện

Yêu cầu mới là hoàn thiện theo plan. Lựa chọn chưa cài/gọi Claude vẫn có hiệu lực. Tiếp tục các artifact local còn thiếu để quyết định live sau khi có bản review được.

- [x] P4.1 bổ sung harness-collaborate dùng một plan AI DevKit, identity/revision, grounded planner prompt và Codex challenge accept/revise/blocked.
- [x] P4.2 liên kết same-worker implementation/resume với fresh review hiện có; không thêm launcher hoặc engine.
- [x] P4.3 tester kiểm link/contract và các nhánh handoff trong một batch local; reviewer kiểm phù hợp proposal và continuity.
- [x] P4.4 ghi local-ready cùng các gate N3/V1 chưa chạy.

Acceptance artifact gồm plan không bị nhân đôi, material disagreement có một lần revise mặc định, missing business rule hỏi developer, worker không bị thay khi accept/resume/correct, reviewer cuối là phiên mới, và không có provider call hoặc quyền mới được cấp bởi skill. H2/H3 live chưa hoàn tất; các phần này cần Claude/phạm vi dữ liệu và bằng chứng permissions tương ứng. H4/H5 vẫn chỉ mở khi điều kiện bằng chứng được đáp ứng.

## Gate còn mở để hoàn thiện toàn bộ plan

| Gate | Trạng thái / đầu vào còn thiếu | Hành động tiếp theo |
|---|---|---|
| N2 Mode B live | Fixture guard + R0/F1/R1 đã chạy, final snapshot current | Fixture đã nghiệm thu; B/C giữ thử nghiệm theo lựa chọn người dùng. |
| N3 Mode C live | Fixture planner/challenge/same-worker implementation/fresh review đã chạy | Fixture đã nghiệm thu; không suy rộng sang mọi project. |
| V1/P6 giữ B/C | User chọn hoãn V1 và giữ B/C thử nghiệm | Chỉ mở pilot khi có budget/criteria/adjudicator chốt trước. |
| H4/H5 | Điều kiện bằng chứng/use case chưa được đáp ứng | Tiếp tục deferred theo proposal, không tự tạo adapter hoặc release service. |

Người dùng trả lời “tiếp tục” sau yêu cầu quyền cài Claude CLI và thử fixture synthetic; hiểu là cho phép bước đó, đã nêu rõ trong commentary. Goal resumed. Đang cài CLI stable từ nguồn chính thức; chỉ dùng fixture synthetic cho đợt N2/N3. Source dự án thật và paid API fallback chưa được mở quyền.

## Tạm dừng theo yêu cầu người dùng

Đã cài Claude Code stable 2.1.311 từ installer chính thức vào ~/.local/bin/claude. Auth status trả loggedIn false, authMethod none; không có API/OAuth token trong environment được phát hiện bằng kiểm tra boolean. Đã mở subscription login và hủy phiên chờ khi người dùng nói “tạm hold cái này, tôi sẽ mua gói Claude sau”. Không gọi model Claude hoặc dùng paid API fallback. Goal paused theo yêu cầu này. Native installer có cơ chế auto-update; lần resume cần ghi lại version thực.

## Trạng thái sau resume

Goal đã được resume, nhưng Claude 2.1.311 vẫn loggedIn=false, authMethod=none qua ba lượt kiểm tra liên tiếp. Chưa có xác nhận mở lại đăng nhập sau yêu cầu hold. Goal chuyển blocked vì N2/N3 cần tài khoản/quyền người dùng. Không mở login hoặc gọi model trong các lượt kiểm tra này. Tiếp tục khi người dùng sẵn sàng đăng nhập hoặc quyết định lại phạm vi nghiệm thu.

## Đã đăng nhập, tiếp tục N2/N3 fixture

Người dùng đã có tài khoản và hoàn tất đăng nhập. CLI 2.1.311 auth status exit 0, loggedIn true, authMethod claude.ai, subscriptionType pro. Chỉ mở lại các test synthetic đã được phép. Đang thử native restricted reviewer với Read/Glob/Grep, dontAsk, MCP rỗng, setting sources rỗng, hooks/auto-memory tắt và fresh nonpersistent session. Chưa coi help/config flags là permission evidence trước kết quả guard thực.

## N2/N3 fixture đã hoàn tất thực thi

Đã chạy một batch có guard + N2 R0/F1/R1 + N3 planner/review qua Claude Code 2.1.311 đăng nhập Pro. Native profile restricted chỉ có Read/Glob/Grep, MCP rỗng, dontAsk; ba phép truy cập outside-path bị từ chối và inside read thành công. Đây là native file-tool boundary, không phải tuyên bố OS-process sandbox.

N2 dùng defect cài sẵn để kiểm workflow. Fresh R0 phát hiện blocker, parent tái hiện, F1 bắt đầu tiêu thụ một lượt sửa, test hồi quy từ fail sang pass, R0 snapshot bị từ chối stale, fresh R1 không có blocker và final snapshot hiện hành. Hai review calls, một completed correction cycle. Không diễn giải fixture seeded thành first-pass productivity.

N3 dùng một Claude plan có SHA revision, cùng Codex worker 01a1f905-9b82-7eb0-a598-59c4e8027984 challenge/implement và giữ continuity qua follow-up. Ba tests và năm API assertions đạt. Fresh Claude reviewer khác planner không có blocker. Một draft xung đột contract được worker trả revise mà không sửa source. Nonblocking câu hỏi provenance comment được giải bằng snapshot trước-worker và tree-to-tree diff.

User chọn “Chốt fixture, hoãn V1 và giữ B/C thử nghiệm”. Do đó không chạy pilot/benchmark mới hoặc bật rộng. B/C chỉ được ghi nhận operational trong fixture scope, từng task mới vẫn cần phép chia sẻ/quyền phù hợp. H4/H5 tiếp tục deferred theo điều kiện proposal.

Evidence đã lọc ở testing/n2-n3-native-report.json. Implementer cập nhật README/shared native profile và hai skill; tester đang kiểm delta, reviewer tiếp theo trước khi đóng handoff.

## Correction cuối của entry

Reviewer phát hiện command trong README chưa loại inherited auth/provider env trong khi driver test đã strip chúng. Đã giao cùng implementer sửa README bằng subshell preflight từ chối mọi ANTHROPIC_* cùng các biến Claude token/third-party selectors, chỉ in tên và không đổi môi trường global. Guard failure hoặc cd failure dừng invocation. Tester/reviewer đang xác nhận delta bằng giá trị giả, không gọi lại provider.

## Bàn giao cuối trong phạm vi đã chọn

Final development code_reviewer trả REVIEW_PASS sau correction entry auth/provider env. Tester và reviewer kiểm guard bằng giá trị giả, source README hash khớp bản được review; không gọi lại provider hoặc chạy suite rộng khi code không đổi. Các mục triển khai và functional fixture trong phạm vi người dùng chọn đã hoàn tất. V1/P6 hoãn rõ ràng, B/C chỉ experimental fixtures, H4/H5 deferred theo điều kiện proposal.

File thay đổi còn ở working tree; chưa commit/push/deploy hoặc kích hoạt cho repo khác. H1 scope CLI đã được chấp thuận trước đó; mọi task mới vẫn phải có quyền/dữ liệu/checks/review của chính task đó. Report n2-n3-native-report.json là nguồn bằng chứng native mới nhất.

## Correction được mở sau yêu cầu đối chiếu proposal

- [x] Đối chiếu source v3.2 với artifact thật; xác nhận native/manual shape là hướng được §11 cho phép.
- [x] Sửa README runtime-first và phân biệt development roles do user bổ sung.
- [x] Audit AI DevKit installed interfaces/capabilities, thêm manifest thật, giữ native/manual fallback khi tmux unavailable.
- [x] Sửa contract actual evidence và bổ sung hai fresh reviews đọc actual test-output artifacts trên snapshots không đổi.
- [x] Tester kiểm manifest, profile/links/skill và report corrections; lint 5/12, profile stub, links, actual evidence và snapshots đạt trong scope.
- [x] Final reviewer kiểm raw evidence, current snapshots, actual tester outputs và conformance; REVIEW_PASS trong phạm vi CLI/fixture đã chọn.

Không coi kết luận hoàn tất fixture trước đây là full v3.2 qualification. V1 được user hoãn; release commit, arbitrary-project instructions/plugin qualification và runtime-provider capabilities ngoài phạm vi đã kiểm còn chưa hoàn tất.

Bước tiếp theo: maintainer xem đối chiếu và các giới hạn, chốt candidate/release Git nếu muốn kích hoạt. Không tự mở V1 hoặc nâng B/C khỏi experimental; chưa tự commit/push hay sửa cấu hình toàn máy. Required human review của task thật tiếp tục theo project.
