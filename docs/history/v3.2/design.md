---
phase: design
title: Review kiến trúc và quyết định triển khai
---

# Review kiến trúc và quyết định triển khai

| Điểm yếu trong kế hoạch trước | Hậu quả | Điều chỉnh |
|---|---|---|
| H0 yêu cầu chứng minh cả khả năng của Claude trước khi giao bản solo. | H1 có thể bị chậm bởi một tích hợp tùy chọn. | H0 kiểm kê toàn bộ, chỉ các điều kiện liên quan đến A nằm trên đường găng H1. |
| Vai trò điều phối của AI DevKit chưa chỉ rõ nguồn trạng thái. | Agent mới có thể cập nhật hai backlog hoặc tự khởi chạy thêm worker. | Dùng lifecycle docs của một feature. Planning giữ trạng thái công việc, testing giữ kết quả, native session giữ execution. Mỗi task coding có một writer. |
| Nhiều mục yêu cầu kiểm tra thực ngay sau từng bước. | Tốn lượt gọi, khó so sánh vì code/config tiếp tục đổi. | Soát tài liệu, interface cục bộ và fixture trong lúc xây. Gom kiểm tra live vào một cửa sổ nghiệm thu trên cùng candidate đã chốt. |
| Cụm “read-only snapshot” gộp độ trung thực của dữ liệu với quyền của tiến trình. | Review có thể thiếu file, hoặc reviewer vẫn ghi được vào target. | N2 kiểm riêng inventory/content và quyền truy cập thực. Khi thiếu một trong hai bằng chứng, ngừng luồng tự động tương ứng. |
| Tiêu chí vận hành và tiêu chí giữ B/C dễ bị hiểu là cùng một mốc. | Một buổi demo thành công có thể dẫn đến bật rộng. | N1–N3 quyết định khả năng vận hành. V1 có đối chứng, người chấm độc lập và ngân sách riêng. |
| Mốc release và Jev có thể bị kéo vào backlog bản đầu. | Tăng dependency trước khi biết solo thiếu gì. | H1 dùng Git và kích hoạt thủ công lúc idle. H4/H5 nằm ngoài đường găng. |

**Quyền quyết định.** Developer chọn mode và phạm vi được chia sẻ. Các skill và tài liệu AI DevKit hỗ trợ requirements → design → planning → implementation → testing/review, giữ liên kết giữa việc và bằng chứng. Parent thực hiện các pha và bàn giao; chưa có runtime AI DevKit tự điều khiển toàn bộ session. Codex ghi project. Claude lập plan ở C hoặc review ở B/C trong phạm vi đã cấp. Native permissions và chính sách dự án thực thi quyền. Đánh giá hiệu quả diễn ra ngoài phiên coding.

**Chọn cách triển khai theo năng lực đã xác nhận.** Tái sử dụng entry, skill và cơ chế resume hiện có. Nếu phiên bản CLI không có task tracking, tiếp tục bằng planning. Nếu không xác lập được quyền reviewer, chỉ dùng bàn giao thủ công được phép. Chỉ bổ sung tiện ích snapshot nhỏ khi Git/native không đủ và có fixture mô tả đúng phần thiếu.

## Quyết định bổ sung về subagent phát triển

Theo xác nhận của chủ dự án, cấu hình .codex được sao chép từ working-after-limit. Parent điều phối, implementer giữ production, unit_tester giữ test sau khi bàn giao, code_reviewer đọc diff/evidence cuối. AI DevKit docs giữ trạng thái. Mode solo dùng cờ tắt subagent rõ ràng. Chỉ dẫn tuần tự là quy tắc hành vi, reviewer không tự có sandbox read-only. Native fixture đã discover và chạy đủ ba role; xem testing/p5-native-roles-report.json. Đây là workflow phát triển repo đã được user bổ sung, còn runtime A/B/C theo các skill riêng.

## P3 snapshot local

Native Git là nền cho capture. Vì review cần đồng thời đối chiếu source chưa commit, approved untracked files, materialized inventory và stale state, dùng một tiện ích stdlib nhỏ cho các bước lặp lại này. Chỉ hỗ trợ layout đã mô tả và kiểm bằng fixture, từ chối layout phức tạp chưa kiểm. Raw Git blobs giúp tránh lỗi export-ignore của git archive. Temporary index bảo toàn index thật. Một capture cần phạm vi whole tracked repo đã được phê duyệt và workspace quiescent; metadata không tự cấp quyền chia sẻ.

Review prompt/template là artifact đọc được. Chưa có lệnh tự gọi provider, cơ chế đo giá trị hoặc service. Native permission isolation vẫn là gate live riêng.

## P4 local

Mode C tái sử dụng một plan AI DevKit, cùng native Codex worker từ challenge qua implementation/correction và harness-review cho fresh review cuối. Chỉ thêm skill điều phối thủ công. Development subagent workflow phục vụ xây harness vẫn riêng với continuity của runtime C. Không thêm session manager, state machine, classifier hoặc launcher.

## Đối chiếu lại với coding-harness-v3.2.md trong repo

| Proposal | Hiện thực và mức bằng chứng | Điểm cần giữ đúng |
|---|---|---|
| §§0–3 native-first, A mặc định, B/C explicit | AGENTS + solo/review/collaborate skills; native CLI và snapshot; README đã đổi runtime-first | Ba development subagents do user bổ sung không được trình bày thành luồng A/B/C mặc định. |
| §4 shared policy/instruction pack | AGENTS và ba skill, role prompts được truyền tường minh cho Claude trong profile | Các đường dẫn skills/collaboration ở cây mẫu §11 là minh họa; .agents/skills là path native đã dùng. Việc nạp policy tùy project/client mới vẫn cần xác minh. |
| §5 snapshot/revision binding | scripts/review_snapshot.py + tests; final snapshots B/C giữ identity trước/sau test/review | actual verification output cần reviewer đọc, summary của worker không đóng gate. |
| §7 AI DevKit reuse | manifest mới, 21 global skills đã audit, docs/lint, session discovery và memory CLI có probe | Runtime hiện là tmux nhưng tmux thiếu, nên start/send live chưa qualified; dùng fallback native/manual theo §7.3. |
| §8 evidence | native reports và actual approved test-result artifacts | Report phục vụ qualification fixture; không tự tính cost/success metrics hoặc suy ra effectiveness. |
| §9 Git-first release | hướng dẫn manual activation/rollback có, worktree còn dirty/uncommitted | Chưa gọi là một release đã pin/triển khai. |
| §11 H2 retention/value gate | user chọn V1 hoãn, B/C experimental | Fixture pass không tự mở rộng sử dụng hay chứng minh lợi ích. |

Audit phát hiện lỗi thật ở mức bằng chứng: final C reviewer trước đó chỉ thấy parent summary, chưa thấy actual test logs. Các kết quả test vẫn có thật; phần gate coverage ban đầu phải được ghi insufficient_evidence. Hai fresh reviewers đã đọc approved test-result.json của B/C và trả no_blocking_findings trên cùng snapshots. Lịch sử review cũ được giữ trong report, số calls được cập nhật thay vì giả định vòng sửa mới.
