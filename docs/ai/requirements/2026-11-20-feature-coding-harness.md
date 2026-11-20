---
phase: requirements
title: Mục tiêu và tiêu chí chấp nhận
---

# Mục tiêu và tiêu chí chấp nhận

Nguồn yêu cầu là *Adaptive Coding Harness v3.2*, ngày 20/11/2026, mục 0–11.2. Chủ dự án quyết định phạm vi dữ liệu, ngân sách, người duyệt bắt buộc và tiêu chí chấp nhận nghiệp vụ. H0–H1 là phạm vi bản dùng hằng ngày đầu tiên. B và C là các thí nghiệm opt-in.

| Goal | Acceptance criteria có thể quan sát | Nghiệm thu |
|---|---|---|
| G0. Tiếp tục công việc từ AI DevKit | Mở planning xác định được hạng mục tiếp theo, phụ thuộc, người phụ trách và nơi ghi bằng chứng. Ma trận H0 nêu khả năng đã xác nhận, chưa biết hoặc không hỗ trợ, có nguồn cho từng kết luận. | Kiểm tra tài liệu + N1 |
| G1. Hoàn tất task bằng Codex solo | Task thường dùng một writer, không phát sinh lượt gọi provider khác. Bug có bằng chứng lỗi trước/sau. Thiếu business rule trọng yếu thì dừng hỏi. Thiếu review bắt buộc thì kết quả thể hiện đúng gate còn mở. | N1 |
| G2. Bảo toàn công việc khi phiên gián đoạn | Resume nhận diện đúng worker, yêu cầu gốc và thay đổi ngoài luồng. Kiểm tra cũ mất hiệu lực khi source liên quan đổi. Rollback cấu hình lúc idle bảo toàn worktree. | N1 |
| G3. Review đúng bản sửa với quyền tối thiểu | Khi chọn B, reviewer mới đọc đúng snapshot, trả finding truy được tới source. Từ chối snapshot sai và review lỗi thời. Tối đa một vòng sửa tự động. | N2 |
| G4. Giải quyết lựa chọn kỹ thuật trước khi sửa code | C có một plan có revision, Codex đối chiếu với source và tiếp tục cùng phiên khi chấp nhận. Bất đồng trọng yếu chưa giải quyết thì dừng. Review cuối dùng phiên mới. | N3 |
| G5. Chỉ giữ workflow phức tạp khi đáng chi phí | Dữ liệu độc lập và tiêu chí chốt trước cho thấy B/C cải thiện nhóm task mục tiêu trong ngân sách. Nếu thiếu bằng chứng, giữ A làm baseline và ghi quyết định thử nghiệm. | V1 |

Jev, tự động kích hoạt release và hệ thống đánh giá ngoài runtime chỉ xem xét theo điều kiện ở planning. Toàn bộ chức năng còn chờ triển khai và nghiệm thu.
