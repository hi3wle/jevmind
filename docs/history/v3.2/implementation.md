---
phase: implementation
title: Hướng dẫn thực hiện và bàn giao
---

# Hướng dẫn thực hiện và bàn giao

## Điểm xuất phát cho P1

| Khả năng | Quan sát hiện có | Việc còn lại |
|---|---|---|
| Workflow docs | AI DevKit CLI 0.77.0 tạo đủ năm tài liệu feature bằng `docs init-feature coding-harness`. | Khi resume, đọc planning trước. |
| Task CLI | `task list --name coding-harness --json` trả về `unknown command 'task'`. | Dùng checklist planning trên bản CLI này. |
| Codex | CLI 0.171.0; login status xác nhận ChatGPT; Darwin arm64; Python 3.15.2. Help hỗ trợ cwd, sandbox workspace-write, approval on-request và resume theo session ID. | Resume thường và sau controlled interruption đã xác minh trong fixture; model resolved, chi phí thực và full effective stack còn chưa biết. |
| Claude / AI DevKit sessions | Claude native restricted fixture đã kiểm. AI DevKit session discovery có probe; start/send hiện vướng tmux thiếu. | Dùng native/manual execution fallback; không gọi AI DevKit session orchestration đã qualified. |
| Repo thử, checks, review bắt buộc | Fixture synthetic tests/fixtures/solo được copy ra thư mục tạm. Baseline lỗi clamp, task greeting, unittest và gate human review đã chạy. | Xem bằng chứng ở testing/n1-native-report.json. |

## Thứ tự dùng trong một task

1. Đọc yêu cầu, policy của repo đích, baseline và diff đang có. Ghi mode, quyền, quyết định còn mở và tiêu chí chấp nhận. Mặc định A. Giữ công việc ngoài task của developer.
2. Với C, Claude xuất một plan có revision. Codex kiểm chứng symbol, contract và quyết định trọng yếu, trả `accept`, `revise` hoặc `blocked`. Tiếp tục cùng worker sau khi accept.
3. Codex triển khai và chạy affected checks của task trên source hiện tại. Ghi command, exit status, môi trường và tham chiếu output. Việc gom test nghiệm thu harness không làm thay đổi nghĩa vụ chạy checks của repo đích.
4. Với B/C, ưu tiên revision bất biến. Nếu có thay đổi chưa commit, dùng temporary index trên workspace sạch đối với phạm vi task, đối chiếu baseline, tree, file mới/xóa, mode, symlink và nội dung đã materialize. Bảo toàn real index. Từ chối input liên quan thiếu identity, source đổi hoặc layout chưa hỗ trợ. Cấp reviewer quyền trên bản đã kiểm tra.
5. Phiên reviewer mới nhận yêu cầu gốc, policy, snapshot/diff và test evidence. Ghi `snapshotId`, paths thực đọc, limitations, finding có location/evidence/expected behavior. Kết quả hợp lệ là `no_blocking_findings`, `changes_required` kèm blocker, hoặc `insufficient_evidence`. F1 dùng hết lượt sửa ngay khi bắt đầu. R1 gắn snapshot mới sau affected checks. Blocker còn lại được báo cho developer.
6. Báo tất cả gate còn mở. Ưu tiên `failed_verification` khi required check đã chạy và fail, sau đó `blocked` khi hết đường tiến, `review_required` khi chờ review, cuối cùng `verified` khi đủ bằng chứng hiện hành. Acceptance của người dùng được ghi riêng.
7. Ghi TaskEvidence v2 tối thiểu khi được phép gồm mode/source, risk, revision, snapshot, role/provider/model thực, refs và outcome. Để unknown cho dữ liệu thiếu, tránh đếm đôi khi resume. Lỗi ghi telemetry chỉ ảnh hưởng khả năng so sánh. Khi bàn giao release, ghi commit, effective config và revision tốt trước đó. Kích hoạt hoặc rollback lúc idle.

**Khi gián đoạn**, kiểm tra worker thực trước khi retry, đọc lại yêu cầu và source sau compaction. Gặp external edit thì dừng ghi phần liên quan, hòa giải và chạy lại affected checks. Gặp xung đột DB/cache/port thì cô lập hoặc tạm dừng. Thiếu quota hoặc quyền thì giữ nguyên công việc và báo bước cần để tiếp tục.

## P1–P2 đã chuẩn bị

Repo mẫu dùng fixture synthetic ở tests/fixtures/solo, được copy sang thư mục tạm trước khi sửa. Task thường thêm dấu câu tùy chọn cho greeting, task bug sửa clamp. Lệnh kiểm tra là python3 -m unittest -v. Dữ liệu giả phục vụ kiểm tra local, chưa có phạm vi chia sẻ source dự án khác sang Claude. Shell hiện không tìm thấy Claude.

AGENTS.md giữ policy, .agents/skills/harness-solo/SKILL.md giữ luồng A, README.md giữ entry/resume/activation. AI DevKit docs giữ control plane. Không cần dependency hoặc launcher mới cho H1. Việc chuẩn bị H1 hoàn tất trong phiên này, phần nghiệm thu live phụ thuộc phiên native hiện hành và được ghi riêng ở testing. Kiểm kê này chưa đủ để ước lượng B/C.

CLI features list với --disable multi_agent --disable multi_agent_v2 xác nhận cả hai flag false cho invocation đó. Đây là bằng chứng parsing/config, khả năng hạn chế tool thực vẫn chờ N1. Cấu hình global chưa được sửa.

Nguồn discovery skill được đối chiếu Context7 /openai/codex, loader host_roots.rs cho .agents/skills và loader/host.rs cho tên invocation. Hành vi discovery trên CLI cài tại máy còn chờ fresh-session smoke.

## Kiểm tra native đã bổ sung

tests/check_native_permissions.py tái chạy sandbox filesystem bằng named profile tạm, không gọi model. n1-native-report.json giữ bằng chứng của một session CLI và lượt resume cùng ID. Phiên test dùng --ignore-user-config nên chỉ chứng minh cấu hình test này. Chưa có thay đổi cài đặt global. Recovery sau controlled interruption đã có bằng chứng; full effective stack vẫn còn mở.

## Bộ cấu hình subagent được clone

Đã clone .codex/config.toml và agents/implementer.toml, agents/unit-tester.toml, agents/code-reviewer.toml từ working-after-limit. Giữ parent/implementer/reviewer gpt-6.1-sol, tester gpt-6.1-terra, effort medium. Giữ cap 3 của nguồn như giới hạn capacity. Bàn giao tuần tự và một writer được quy định trong AGENTS.md. Reviewer trả INSUFFICIENT_EVIDENCE khi thiếu kiểm chứng. Tester tái sử dụng test và chỉ thêm phần coverage cần thiết. Global config không được chỉnh.

README có entry development và entry solo riêng. Không mang các đường dẫn docs, chính sách nghiệp vụ hoặc skill Limit Recover sang harness. Native custom-role fixture đã hoàn tất tuần tự với final model contexts Sol/Terra/Sol medium, 3 tests pass và REVIEW_PASS; xem testing/p5-native-roles-report.json.

## Bàn giao development workflow đang thực hiện

Implementer được gọi với model gpt-6.1-sol, effort medium, fork không mang lịch sử. Đã đọc role instructions, policy, plan và scope H1. Kết quả không cần sửa source/config; structural assertions và CLI feature-disable checks đạt. Tester nhận scope test sau khi implementer kết thúc. Các lần gọi qua collaboration runtime áp dụng role instructions đọc từ file; chưa dùng bằng chứng này để khẳng định native CLI auto-discovery của ba custom role.

## Kết quả bàn giao tuần tự

Implementer, unit_tester và code_reviewer đã hoàn tất lần lượt qua collaboration runtime, đúng model Sol/Terra/Sol medium. Không role nào sửa file. Tester xác nhận filesystem probe, structural config và disposable fixture đạt. Reviewer không thấy lỗi triển khai chặn, nhưng trả INSUFFICIENT_EVIDENCE cho native role discovery và N1 còn thiếu. Các mô tả trạng thái ban đầu trong tài liệu testing là nhật ký theo thời điểm, kết quả mới nhất ở cuối tài liệu.

CLI role smoke lần đầu dừng trước khi triển khai vì project chưa trust và không select được role. Retry trust override thất bại. Fresh fixture được trust bằng native --trust; record trust cho thư mục đó được lưu. MCP rỗng và plugins/apps tắt chỉ áp dụng invocation. Ba role đã chạy native và kết thúc; xem p5-native-roles-report.json.

## Sửa entry theo review

Reviewer xác nhận blocker trong README entry thường nạp MCP cá nhân chưa tương thích với CLI. Đã sửa entry development/solo/resume để dùng cùng override MCP rỗng và plugins/apps tắt đã kiểm. Các lựa chọn model/effort, sandbox và review policy giữ theo cấu hình bàn giao.

## Bàn giao H1 CLI

Bản sửa entry đã được tester xác nhận command parsing và solo feature overrides; code_reviewer trả REVIEW_PASS cho phạm vi người dùng chọn. P2/P5 đã đóng trong planning. Các file bàn giao là README, AGENTS, .agents/skills/harness-solo, .codex/config.toml cùng ba role, fixture/test permission và tài liệu/bằng chứng AI DevKit.

Các thay đổi hiện ở working tree, chưa tạo commit release hoặc cài vào repo khác. Không tự đẩy code hoặc kích hoạt global runtime. Native --trust đã lưu trust riêng cho fixture tạm của P5. Phạm vi chưa kiểm được liệt kê trong testing.

## P3 implementation local đã bàn giao cho tester

scripts/review_snapshot.py có capture/verify. Capture yêu cầu repo root và destination mới bên ngoài target, phê duyệt whole tracked source cùng từng path ngoài Git. Source gồm union HEAD/index, nội dung thực tại worktree, deletions và executable modes. Các file ignored cũng cần approval rõ ràng. Dùng raw blobs và temporary index, lưu metadata ID, inventory và diff, materialize ra thư mục source có thể đọc.

Verify cần snapshot ID đã giữ ngoài artifact, đối chiếu metadata/inventory/bytes/modes/diff và target identity trước/sau. Capture từ chối layout chưa hỗ trợ, dọn riêng destination mới nếu thất bại. Workspace phải quiescent; before/after checks không chứng minh không có transient change rồi revert. Capture tạo Git objects và giữ content trong memory.

Skill harness-review cùng result-template mô tả manual fresh review, yêu cầu quyền riêng, status/finding invariants, R0/F1/R1 và evidence v2 có thể tham chiếu. Không tự gọi provider hoặc đo giá trị. Implementer syntax/help/smoke đạt; tester đang bổ sung suite local. Ban đầu smoke gặp canonicalization /var trên macOS, đã sửa parent-path resolution trước khi bàn giao.

## P3 local-ready

Unit tester bổ sung tests/test_review_snapshot.py và chạy một suite CLI local 7 test đạt. Code reviewer kiểm lại suite và inject SnapshotError ở cat-file/blob sau khi destination đã tạo: lỗi truyền ra, destination dang dở được xóa, index và source giữ nguyên. Final REVIEW_PASS cho phạm vi local.

Source helper SHA-256 de356bffa20bcf29c88cd723f3a5e7264cfde47f212c9858cb336f110efc9f2a. Test SHA-256 aa800540faea1dee01ab8f445dd6164e394ad5e186a1a66571ccad2b9e108732. Parent đã đối chiếu lại hash sau review. Không có install, provider call, release commit hoặc cấu hình global mới trong P3.

Giới hạn thực tế gồm quiescent authorized whole-tracked repo, explicit approval cho mọi untracked/ignored file, content giữ trong memory và các layout phức tạp bị từ chối. Helper tạo Git objects nhưng giữ real index. Snapshot ID phải giữ ngoài artifact. Local snapshot integrity không chứng minh quyền reviewer hay tính hữu ích của Mode B.

## P4 local-ready

Đã thêm .agents/skills/harness-collaborate/SKILL.md và hướng dẫn H3 trong README. Dùng một plan AI DevKit có revision, grounded planner prompt, challenge accept/revise/blocked, same-worker implementation/correction/resume và reuse harness-review. Không thêm script, provider API, launcher hoặc plan thứ hai.

Implementer, tester và reviewer hoàn tất tuần tự với cấu hình Sol/Terra/Sol medium. Validator hợp lệ, 7 local links resolved, contract walkthrough phù hợp và final REVIEW_PASS cho artifact. Parent kiểm lại SHA-256 khớp bản reviewed: skill 47599e2868fb6af7fb374a29d44460a00caa223909fbb7c187ebf8363269bf90; README bc83cc5ce33a160732862f98e37d9fe33b497c24224d52e871ffd21717129060.

Tra tài liệu công khai qua Context7 xác nhận CLI có native installation, dontAsk và strict-mcp-config; chưa cài hoặc thử các khả năng này. Đây là thông tin chuẩn bị, không phải bằng chứng permission enforcement. Nguồn chính thức tại https://code.claude.com/docs/en/setup và https://code.claude.com/docs/en/cli-reference.

## Cài CLI và hold trước runtime

Sau khi người dùng nói tiếp tục, đã tải/đọc installer chính thức claude.ai/install.sh và chạy stable. CLI cài thành công version 2.1.311 tại ~/.local/bin/claude. Kiểm tra auth chưa đăng nhập. Đã mở claude auth login --claudeai, sau đó hủy bằng Ctrl-C theo yêu cầu người dùng hold để mua gói sau. Không có Claude inference, không gửi fixture/source. Các flags permission chỉ mới đọc help, chưa được coi là đã kiểm runtime.

## Native B/C đã chạy trên fixture

CLI installed 2.1.311, auth claude.ai/Pro. Model alias sonnet được runtime báo claude-sonnet-5-5, effort medium. Trusted neutral runner và approved snapshot là working directories cho --restricted. Tools chỉ Read/Glob/Grep, dontAsk, strict-mcp-config với MCP rỗng, setting sources rỗng, hooks/auto-memory tắt, slash commands disabled và no-session-persistence. Không dùng --bare, paid API fallback, Bash, Write hoặc Agent tools phía Claude.

Năm phiên Claude riêng gồm permission guard, B R0, B R1, C planner, C reviewer. Native metadata và tool denials được lưu qua report đã lọc. Same Codex worker gpt-6.1-sol medium (native thread 01a1f905-9b82-7eb0-a598-59c4e8027984) sửa F1, challenge/implement C và từ chối draft xung đột. Parent kiểm snapshots và tests thực, không dùng consensus làm correctness proof.

First temporary evidence collector assumed challenge key status while artifact used decision; collector stopped before provider invocation, corrected against actual artifact/revision, then continued. Đây là bước thu thập test tạm, không thay đổi helper production. Nonblocking provenance question về comment được adjudicate bằng snapshot planning source và worker-only diff.

README và hai skill đã được cập nhật bằng shared native invocation đã chạy, không thêm launcher/provider framework. User hoãn V1, B/C tiếp tục experimental fixtures. Raw model logs ở thư mục tạm synthetic, report repo chứa metadata và kết quả cần thiết, không có credentials hay prompt toàn bộ. Final tester/reviewer handoff đang tiếp tục.

## Guard auth/provider trong entry

Chỉ README được sửa trong correction cuối: preflight trong subshell reject inherited ANTHROPIC_* và CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY. Nó kiểm tên, không in giá trị; guard hoặc cd thất bại ngăn gọi Claude. Không thêm launcher/script mới hay đổi môi trường/cấu hình global. Native provider tests không rerun vì chỉ bổ sung precondition local với điều kiện sạch tương ứng tested driver.

## Bàn giao native fixture cuối

Final reviewer xác nhận blocker entry đã được sửa và trả REVIEW_PASS cho accepted synthetic scope. Guard validation gồm clean args qua stub, 12 negative variable cases bởi tester và 14 bởi reviewer, failed-directory/interpreter handling và syntax/whitespace đều đạt. README SHA-256 3002957e9142cf3a65d3e5b917fdc0dc57193c072832ca0a932feb32e54a6102 đã được parent kiểm lại.

Không có script/framework/provider adapter mới trong giai đoạn native qualification, chỉ cập nhật README, hai skill và evidence/docs. Existing snapshot helper/tests được tái sử dụng. Auth Pro đã đăng nhập; Claude stable 2.1.311 được cài từ bước trước. Các thay đổi nguồn vẫn chưa commit hoặc phát hành cho project khác. V1 deferred, B/C experimental theo user decision.

## Correction sau proposal conformance audit

Đã bổ sung .ai-devkit.json theo schema thật, reuse 21 global Codex skills. Status trước correction báo missing project config; sau thêm manifest, project ready. Overall readiness vẫn fail vì môi trường tmux/MCP còn thiếu, không cài thêm hoặc đổi runtime provider để che vấn đề. Các read probes đã lưu trong ai-devkit-capability-report.json.

README bắt đầu bằng runtime A/B/C và mapping proposal; development workflow được chuyển xuống sau nguyên nội dung. Handoff skills yêu cầu reviewer đọc actual approved result artifact/verbatim output, command/exit/source binding; thiếu bằng chứng => insufficient_evidence. Trusted runner có thể chứa đúng approved evidence, không auto-load target instructions.

Đã chạy lại affected actual-output reviews trên B/C snapshots không đổi, không gọi lại planner hoặc sửa source. Hai test-result artifacts được tạo từ actual subprocess output, source verify trước/sau exit0. Raw Read tool events xác nhận reviewers đã đọc file log thực. B review calls tăng từ 2 lên3, completed correction cycle vẫn1; C reviewer calls từ1 lên2. Original static responses/coverage gap giữ trong n2-n3-native-report.json.conformanceCorrection.
