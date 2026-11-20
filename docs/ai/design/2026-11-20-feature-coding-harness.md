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

**Quyền quyết định.** Developer chọn mode và phạm vi được chia sẻ. AI DevKit điều phối các pha requirements → design → planning → implementation → testing/review, giữ liên kết giữa việc và bằng chứng. Codex ghi project. Claude lập plan ở C hoặc review ở B/C trong phạm vi đã cấp. Native permissions và chính sách dự án thực thi quyền. Đánh giá hiệu quả diễn ra ngoài phiên coding.

**Chọn cách triển khai theo năng lực đã xác nhận.** Tái sử dụng entry, skill và cơ chế resume hiện có. Nếu phiên bản CLI không có task tracking, tiếp tục bằng planning. Nếu không xác lập được quyền reviewer, chỉ dùng bàn giao thủ công được phép. Chỉ bổ sung tiện ích snapshot nhỏ khi Git/native không đủ và có fixture mô tả đúng phần thiếu.
