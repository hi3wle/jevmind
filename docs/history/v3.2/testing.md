---
phase: testing
title: Một đợt nghiệm thu chung
---

# Một đợt nghiệm thu chung

**Trạng thái hiện tại: correction sau đối chiếu proposal đã qua tester và final reviewer REVIEW_PASS trong phạm vi CLI/fixture. Đây không phải full v3.2 qualification; AI DevKit overall readiness vẫn fail, B/C experimental và V1 hoãn.** Khi P2 và các mode thuộc phạm vi bàn giao đã chuẩn bị xong, mở một biên bản cho một candidate. Ghi commit, config/profile thực, môi trường, task fixture, phạm vi provider được duyệt và người chấm. Dùng fixture local để tạo các biến thể lỗi; chỉ gọi provider thật cho luồng đại diện đã được phép. Mỗi quan sát có thể phục vụ nhiều AC. Điều chưa quan sát phải ghi là chưa xác minh.

| Nhóm / phạm vi | Cách gom kiểm tra | Bằng chứng đủ để kết luận |
|---|---|---|
| N1 · A và phục hồi | Trên repo mẫu chạy task thường và bug với Claude/Jev/Lab vắng mặt. Trong cùng đợt kiểm tra resume, external edit, stale check, thiếu business rule, review bắt buộc đang chờ, failure/quota và xung đột tài nguyên. Dùng bản cấu hình trước để diễn tập rollback lúc idle. | Baseline/final diff và output checks, worker/session, thay đổi developer còn nguyên, kết quả từng gate, bản cấu hình khôi phục. G0–G2. |
| N2 · B opt-in | Một lượt review trên snapshot có blocker, một lần sửa và re-review trên snapshot mới. Gom fixture cho untracked/deletion/mode, export-ignore, symlink ngoài phạm vi, real index dirty, external edit, phản hồi mâu thuẫn/thiếu và R1 còn blocker. Kiểm quyền reviewer trên môi trường đã cấp bằng thao tác vô hại trên dữ liệu giả. | So khớp inventory với bản materialized, index thật bảo toàn, bằng chứng quyền thực, review refs gắn đúng revision. Biến thể lỗi phải làm gate tương ứng còn mở; lỗi ghi evidence giữ usage là unknown. G3. |
| N3 · C opt-in | Một task có lựa chọn kỹ thuật thực: lưu plan, challenge, resume cùng worker, implement, fresh review. Dùng biến thể plan để đối chiếu sai symbol sửa được và xung đột contract cần revise/block. | Plan revision, challenge có căn cứ, worker nhất quán, review cuối đúng snapshot và số vòng trong ngân sách. G4. |

**Mẫu biên bản.** Với mỗi nhóm ghi candidate, phạm vi, thao tác thực hoặc fixture, expected/actual, command và exit nếu có, evidence ref, kết quả đạt/trượt/chưa xác minh/ngoài phạm vi, gate còn mở và người quyết định. Chưa cấp quyền B/C thì bỏ khỏi phạm vi phát hành. Nếu phải sửa candidate sau đợt chung, chỉ tái kiểm các gate bị ảnh hưởng và gắn bằng chứng với bản mới.

## V1 · Phép đo trước quyết định giữ B/C

Chỉ kích hoạt khi có mục tiêu giữ hoặc mở rộng B/C. Trước lượt đầu, khóa tập task, comparator, nhãn độc lập, ngân sách, số lần xác nhận, tiêu chí quality/benefit, trần chi phí/thời gian và mức dữ liệu tối thiểu. Chưa chốt thì chỉ được diễn giải kết quả như thăm dò.

- Bước chẩn đoán cho B theo §11.2 của proposal dùng 6 patch cài lỗi (2 nghiệp vụ, 1 contract, 1 xử lý lỗi, 1 biên, 1 trạng thái/concurrency) và 3 patch sạch đã kiểm tra. So fresh Codex với fresh Claude trên cùng đầu vào, giấu nhãn. Chỉ gọi self-review khi dùng phiên implementation gốc. Ghi recall, precision, clean patches bị chặn nhầm, lỗi mới và số claim chưa phân xử.
- Quy tắc sàng lọc mặc định cần N2 đạt, ít nhất một lỗi material bắt thêm đã được xác nhận, không thêm false blocker. Nếu qua, so A, A reasoning cao và B từ đầu task tới acceptance. Với C, so C với B và A reasoning cao trên task có quyết định thiết kế.
- Ghi task success, first-pass tại lần bàn giao đầu, tổng cost/credits theo provider trên task được chấp nhận, median time-to-acceptance và số lượt developer phải yêu cầu sửa. Dùng unknown khi thiếu số liệu. Người chấm độc lập ghi quyết định giữ opt-in cho nhóm đã đo, sửa và đánh giá lại, hoặc hoãn. Một lượt smoke vận hành chưa đủ bằng chứng để kết luận lợi ích.

## Biên bản N1 local — 20/11/2026

Candidate là working tree kế tiếp commit 2dddaf8, gồm policy, skill solo, entry hướng dẫn và fixture. Người thực hiện là Codex worker của phiên hiện tại, trên Darwin arm64, Python 3.15.2. Không có phiên model bổ sung.

Một Python batch đã copy fixture sang TemporaryDirectory, khởi tạo Git, chạy unittest baseline, thêm greeting punctuation cùng check tương ứng, sửa clamp trong bản copy, chạy unittest cuối và kiểm tra file developer-note còn nguyên. Baseline exit 1 với 3 subcase clamp fail, greeting pass. Sau sửa, unittest exit 0 với 2 test methods và toàn bộ 5 subcase clamp pass. Assert giữ file developer-note pass. Batch exit 0. Bản fixture trong repo giữ lỗi có chủ đích cho lần tái hiện sau. Đây là bằng chứng test trên bản copy, chưa chứng minh phản ứng của một phiên mới với policy.

Quick validator của skill-creator báo Skill is valid. AI DevKit lint --feature coding-harness đạt 12 checks. Git diff --check exit 0. CLI chấp nhận flags và báo hai feature multi-agent false. Task CLI probe vẫn trả unknown command.

Các gate N1 còn mở gồm tự nạp AGENTS/skill ở phiên mới, quyền filesystem/tool thực, disconnect/resume đúng worker, phản ứng trước external edit, invalidation sau source change, thiếu business rule, mandatory human review, quota/network, tài nguyên chung và activation/rollback lúc idle. Những tình huống này chưa quan sát, chưa được đánh dấu đạt. B/C chưa có Claude và chưa mở phạm vi dữ liệu, N2/N3 và V1 chưa chạy.

## P5 native smoke — 20/11/2026

Chủ dự án đã cho phép một phiên Codex CLI trên fixture synthetic dùng auth ChatGPT hiện có. Đã dùng --ignore-user-config để tránh nạp các MCP/plugin cấu hình cá nhân ngoài phạm vi test; đây là cấu hình thử riêng, chưa xác minh stack plugin thực dùng hằng ngày.

Phiên CLI 0.171.0 với multi_agent và multi_agent_v2 tắt, workspace-write, approval on-request đã đọc AGENTS.md và skill harness-solo, tái hiện baseline rồi sửa cả hai task. Ba test cuối đạt. Phiên trả review_required đúng yêu cầu human review còn mở.

Sau khi handle đầu kết thúc exit 0, resume bằng session ID 01a1f77a-8006-78a0-b158-f960f09b8630. Thread ID trong hai lượt giống nhau. Trước resume có file developer-note và comment trong source. Phiên đọc lại rule và source, giữ thay đổi, chạy lại ba test đạt với hash hiện tại. Yêu cầu mới thiếu quy tắc empty-name được chuyển thành câu hỏi cho developer, không sửa đoán. Đây là resume sau một lượt hoàn tất, chưa mô phỏng mất kết nối đột ngột.

Bằng chứng lệnh/test và session lưu tại n1-native-report.json, đã loại bỏ prompt/transcript. Skill có trong catalog của chính lượt goal tiếp tục. Test python3 tests/check_native_permissions.py exit 0 chứng minh named profile thử cho phép ghi workspace và chặn ghi ngoài workspace. Profile này được truyền bằng override tại lệnh probe, khác cấu hình legacy flags của smoke. Chưa kiểm quyền các MCP/plugin ngoài phạm vi.

Đã diễn tập kích hoạt và rollback file skill trong fixture idle, khôi phục đúng bytes cũ và giữ file developer-note. Không đổi cấu hình global.

G0 và phần chức năng solo của G1 có bằng chứng. G2 có resume bình thường, external edit và recheck hiện hành. Các gate mất kết nối giữa lượt, quota, port/DB/cache dùng chung, stack plugin cá nhân và reviewer isolation vẫn chưa kiểm. H1 vẫn là candidate, chưa tuyên bố đầy đủ N1. N2/N3 chưa chạy vì thiếu Claude/phạm vi dữ liệu. V1 chưa có ngân sách/ngưỡng.

## Kiểm tra cấu hình subagent đã clone

Python tomllib đọc thành công .codex/config.toml và ba file role. Assert kiểm tên role, đường dẫn tồn tại, model/effort đúng nguồn và cấm spawn lồng đạt. codex features list exit 0 sau khi thêm cấu hình. Việc đọc config/structural check chưa chứng minh client discover role hoặc model có trong tài khoản.

Bổ sung P5 một luồng nhỏ trên fixture cho implementer → unit_tester → code_reviewer với bàn giao tuần tự, kiểm quyền reviewer và kết quả hiện hành. Chưa gọi model hoặc khởi chạy subagent cho yêu cầu clone cấu hình này.

## Recovery sau gián đoạn đã đối chiếu

Đã đọc log recovered.jsonl từ lượt chạy trước khi goal tạm dừng. Tiến trình bị SIGINT sau khi recovery-marker.txt được tạo, exit 1. Parent xác nhận process group cũ đã biến mất trước khi resume. Log recovery có cùng thread ID 01a1f77a-8006-78a0-b158-f960f09b8630, turn.completed và affected checks exit 0 với 3 test đạt. Hash source/test/developer-note khớp lượt trước, marker được giữ. Đã bổ sung kết quả vào n1-native-report.json. Đây là controlled interruption; quota exhaustion và mất mạng thực chưa thử.

## Review H1 theo workflow development

Ba role đã được gọi tuần tự qua collaboration runtime bằng model được chỉ định. Tester chạy filesystem probe exit 0, cross-reference TOML exit 0, fixture baseline expected fail rồi final 3 tests pass. Reviewer trả INSUFFICIENT_EVIDENCE do native role auto-discovery và N1 quota/shared-resource cases chưa kiểm. Không có blocking implementation defect được xác nhận. Không coi các lời gọi collaboration này là native custom-role discovery.

Các mô tả “chưa xác minh recovery” trong nhật ký trước lượt recovery là lịch sử. Kết quả hiện tại gồm controlled interruption recovery như phần bên trên. Native CLI smoke custom-role lần đầu xác nhận project-local config bị tắt khi chưa trust và dừng an toàn, không tự thay role.

## Native discovery đang chạy

Lượt dùng --ignore-user-config không nạp project trust. CLI không cho kết hợp --trust với --ignore-user-config. Khi bỏ ignore-user-config, cấu hình MCP cá nhân báo invalid transport. Override toàn bộ mcp_servers={} cùng tắt plugins/apps chỉ cho invocation giúp CLI render và chạy được. Native --trust được áp dụng cho thư mục fixture tạm; đây là trust record riêng của fixture và có thể tồn tại sau phiên. Không đổi cấu hình provider/model/MCP global.

Fresh session 01a1f787-e52e-7392-9be0-1368d9df58e3 với multi_agent_v2 enabled đã gọi spawn_agent có agent_type implementer. Implementer kết thúc, parent kiểm source và chuyển sang unit_tester. Lượt chạy vẫn đang tiếp tục, chưa đánh dấu workflow đạt.

## P5 native roles hoàn tất

Fresh CLI thread 01a1f787-e52e-7392-9be0-1368d9df58e3 đã kết thúc turn.completed. Parent raw session ghi ba spawn_agent theo thứ tự implementer → unit_tester → code_reviewer. Các final turn_context tương ứng là Sol/Terra/Sol medium. Implementer chỉ sửa production fixture, tester thêm punctuation test sau bàn giao, reviewer trả REVIEW_PASS. Parent kiểm tra trạng thái/source giữa các lượt và rerun cuối 3 tests pass. Developer-note giữ đúng nội dung.

Bằng chứng tối thiểu đã lọc tại p5-native-roles-report.json gồm role calls, child IDs/context model, checks và kết quả. Đây là runtime fixture có V2 bật, trust riêng thư mục tạm, MCP rỗng và plugins/apps tắt. Native trust record của fixture tồn tại theo hành vi --trust. Không suy rộng kết quả sang toàn bộ MCP/plugin cá nhân hoặc human acceptance.

## Quyết định nghiệm thu của chủ dự án

Người dùng chọn “Nghiệm thu CLI đã kiểm, ghi rõ các giới hạn còn lại” sau khi được thông báo phạm vi MCP/plugins tắt và các mục quota, tài nguyên dùng chung chưa thử. Phạm vi bàn giao gồm solo fixture, resume thường, recovery sau controlled interruption, policy/skill đã nạp, native custom roles tuần tự, filesystem probe và rollback fixture.

Các mục ngoài bằng chứng gồm toàn bộ MCP/plugin cá nhân, quota/network failure thực, shared-resource conflicts, enforced reviewer read-only và resolved backend model versions. Giữ unknown cho cost, acceptance của task thật và các số đo hiệu quả. B/C chưa triển khai; Claude chưa có trong shell, phạm vi dữ liệu và value gates chưa chốt. H4/H5 vẫn deferred theo plan.

README entry đã sửa để dùng scoped tool stack đã chạy. Chỉ chạy lại structural/parser checks cho delta này. Final reviewer đã xác nhận bản sửa.

## Kết quả cuối

Final code_reviewer trả REVIEW_PASS cho user-selected H1 CLI scope sau bản sửa entry. Tester xác nhận cả bốn command shapes parse exit 0, config/role refs hợp lệ và solo tắt apps/plugins/cả hai multi-agent feature. Filesystem probe chạy lại exit 0, skill validator hợp lệ, git diff --check exit 0 và AI DevKit feature lint đạt 12 checks.

G0–G2 đạt trong phạm vi fixture/CLI được người dùng chọn. G3–G5 thuộc B/C và đánh giá hiệu quả tiếp tục deferred theo điều kiện ở planning. Phạm vi này hoàn tất; không suy ra full N1 coverage hoặc acceptance của task coding thực tế.

## Đợt P3 local kế tiếp

Chỉ chạy local theo lựa chọn người dùng. Tester sở hữu một batch regression cho capture/verify trên Git fixture dùng một lần, gồm tracked modification/new/deletion/mode, untracked approval, real index dirty, export-ignore fidelity, unsupported layouts, snapshot missing/extra/tamper, stale source và lỗi cleanup/containment. Reviewer đối chiếu với §5.1 proposal và acceptance local trong planning. Claude invocation, read-only process isolation, R0/F1/R1 thực và pilot V1 chưa chạy.

## P3 implementation smoke

Implementer báo syntax/help/diff checks và disposable capture/verify smoke exit 0. Smoke bao phủ tracked modification/deletion/executable mode/export-ignore, approved extra, real index unchanged và stale-target rejection. Đây là kiểm tra implementation ban đầu, suite regression độc lập của unit_tester đang chạy; chưa có kết luận nghiệm thu local.

## Kết quả đợt P3 local

- python3 -m unittest discover -s tests -p test_review_snapshot.py -v exit 0, 7 test đạt, gồm các subcase kiểm fidelity, scope approvals, index preservation, stale identity, artifact tampering, unsupported layouts và destination safety.
- Reviewer inject lỗi cat-file/blob sau destination creation trong fixture tạm: exit 0 của phép kiểm, SnapshotError được truyền ra, partial destination bị xóa, bytes real index và source giữ nguyên.
- Skill validator harness-review hợp lệ. git diff --check exit 0. AI DevKit feature lint đạt 12 checks.
- Final code_reviewer REVIEW_PASS cho local readiness. Parent kiểm source/test hashes khớp bản reviewer đã đọc, ghi ở implementation.

Người dùng chỉ cho phép chuẩn bị local. N2 live, Claude permissions/isolation, R0/F1/R1 thực và V1 vẫn chưa kiểm, không suy ra từ các fixture. H1 acceptance trước đó giữ nguyên phạm vi đã chọn.

## P4 local đang chuẩn bị

Tester sẽ kiểm contract/link và walkthrough local cho feasible plan, minor wrong symbol, material contract conflict, missing business rule, interrupted worker và unavailable planner/reviewer. Đây là kiểm tra artifact, chưa phải evidence N3 với provider thật. N3/value gates được giữ mở.

## Kết quả P4 local

Tester và reviewer chạy skill validator exit 0, kiểm 7 local links đều resolved và walkthrough các nhánh accept, minor correction, material revise, blocked requirement, exact-worker resume, absent planner/reviewer và fresh review có giới hạn. Reviewer kiểm thêm 12 contract anchors và git diff --check exit 0. Final REVIEW_PASS cho artifact, parent đã kiểm hash source khớp bản reviewed.

Các phép kiểm này là inspection của instruction pack, không chứng minh hành vi provider hoặc N3 runtime. Không cài/call Claude, không đổi global config, không chạy live models cho Mode C. Goal toàn bộ còn chờ các gate runtime/evaluation trong planning.

## Đợt nghiệm thu N2/N3 native synthetic

Account status xác nhận loggedIn true, authMethod claude.ai, subscriptionType pro. Profile actual và các session IDs nằm trong n2-n3-native-report.json. Dùng nguồn synthetic, không gửi source dự án thật.

Guard đọc snapshot thành công và Read/Glob/Grep outside-scope bị native --restricted từ chối; tools init chỉ ba tool đọc và MCP []. N2 seeded patch có test default pass nhưng custom punctuation fail; R0 finding được xác nhận độc lập, F1 regression fail-to-pass rồi 2 tests pass, old snapshot stale, fresh R1 no_blocking_findings và verify cuối exit 0. Cycle record consumed=true từ F1, completed=1 sau R1, reviewCalls=2.

N3 planner đọc snapshot, output một plan được hash. Same-worker challenge accept và implementation/test trong cùng native thread; 3 test methods và 5 API assertions pass. Counterfactual draft phá backward compatibility trả revise với source unchanged. Fresh review ID khác planner, không có blocker, snapshot verify sau review exit 0. Reviewer không chạy code và không làm theo instruction độc hại trong comment; write/exec tools không được cấp. Một nonblocking provenance question về comment được giải bằng snapshot có comment trước khi worker bắt đầu và diff tree-to-tree không thêm nó.

Giới hạn: chưa chạy V1 9-patch diagnostic hoặc end-to-end comparison, chưa chứng minh cost/time superiority, không mở production broad rollout. Không ép quota/network failure hoặc disconnect trong chính C batch; N1 recovery là bằng chứng native riêng. Không coi profile này là OS sandbox hoặc bằng chứng không auto-load bất kỳ CLAUDE.md nào trong repo tùy ý. Native file-tool restrictions đã quan sát trên fixture cụ thể.

User chọn chốt fixture, hoãn V1, giữ B/C thử nghiệm. Final validation chỉ kiểm profile/skill delta và tính nhất quán evidence, không gọi lại provider/suite rộng khi không có thay đổi code.

## Final profile delta và correction

Tester kiểm hai skill validators, links, shell syntax, CLI --help parsing và args match driver đều exit 0. Native report được đối chiếu năm session IDs, raw init/result/tool denials, review JSON, challenge/plan hash/cycle và bốn snapshot manifests; verify B/C final đều exit 0.

Final reviewer xác nhận evidence đủ cho fixture scope và tự kiểm native Codex metadata cùng một thread qua bốn Sol-medium turns. Reviewer trả REVIEW_FAIL do README command kế thừa auth/provider env khác với tested driver. Implementer đã sửa guard chỉ theo variable names, xử lý cả giá trị rỗng và cd failure, không lộ secret values hoặc đổi global env. Đang kiểm correction này local; chưa final pass của handoff mới.

## Final REVIEW_PASS cho fixture scope

Tester và reviewer độc lập xác nhận entry correction đúng bằng actual README hash, clean stub invocation và các trường hợp override có/rỗng. Tester 12/12 rejection cases, reviewer 14/14 rejection cases; missing runner và preflight failure không gọi stub. Không lộ giá trị môi trường, không đổi global config/env. Final reviewer REVIEW_PASS trong scope user đã chọn, không có blocker còn mở cho handoff này.

Bằng chứng native N2/N3 và final guard nằm ở n2-n3-native-report.json. Những giới hạn còn lại gồm V1 chưa chạy, cost/time benefit chưa biết, arbitrary-project/full plugin/OS isolation và CLAUDE.md auto-discovery chưa qualify. Không suy diễn required human review của task thật đã được thay thế, không bật rộng B/C.

## Proposal conformance audit và affected re-review

Audit chỉ ra review cuối trước đây không đọc actual output logs, nên gate evidence coverage chưa đủ dù tests đã chạy thật và được lưu. Đã tạo approved artifacts có command/exit/stdout/stderr/environment/source snapshot ID trước-sau từ actual subprocess runs (B2 tests, C3 tests), không dùng summary. Reviewer mới của từng mode đã Read test-result.json thực và source/diff, testsSeen ghi actual outcomes, cả hai no_blocking_findings. Parent xác nhận file SHA và final snapshot verify exit0 sau reviews.

Native report giữ response cũ cùng classification initialGateCoverage=insufficient_evidence; không sửa lịch sử thành đã đọc logs. Tổng fresh Claude sessions nay7, B reviewCalls3 completed correctionCycles1, C reviewerCalls2. Review bổ sung không tạo F2 hoặc code correction mới. Actual-output artifacts cùng Read tool IDs nằm trong conformanceCorrection.evidenceInspections.

AI DevKit audit evidence riêng tại ai-devkit-capability-report.json. Chưa có provider live start/send qua AI DevKit vì cấu hình tmux thiếu executable; native/manual fallback được ghi rõ. Tester và final reviewer đã kiểm correction source/docs; final REVIEW_PASS.

Final conformance review độc lập xác nhận actual Read trong raw logs, SHA artifact, source binding và hai snapshot verify exit 0. Tester lint 5 checks và feature lint 12 checks đạt; shell/link/profile-stub checks đạt, không gọi provider thêm cho thay đổi profile/docs. Actual tester output giữ local tại `/var/folders/sm/t_3g1b1n3l73b0fjjfylchw00000gn/T/harness-conformance-check-f3vepdg0/actual-output.txt` (có local environment details; không xuất bản). Reviewer tự kiểm shell/links/report/diff, không thấy blocker. README identity hiện hành cùng skill/manifest hashes ở conformanceCorrection.finalDevelopmentReview.

AI DevKit status command exit 0 nhưng readiness overall fail: project config pass, tmux thiếu, Claude managed hook chưa có, Codex hook có stale mapping warning, memory MCP unwired và chỉ 21/28 built-in Codex skills hiện diện. Không cài thêm hoặc sửa global để che các giới hạn. Smoke phạm vi sửa: native project-status flow và shell profile qua stub đạt; provider actual-output re-review B/C đã chạy như trên. Chưa chạy broad suite/V1 hoặc release activation; acceptance của người dùng không tự suy ra từ REVIEW_PASS.
