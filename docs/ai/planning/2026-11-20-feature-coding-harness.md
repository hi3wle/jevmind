---
phase: planning
title: Kế hoạch triển khai và trạng thái
---

# Kế hoạch triển khai và trạng thái

Đây là backlog chính của feature. Maintainer cập nhật trạng thái ngay trên dòng công việc khi bàn giao. “Đã chuẩn bị” nghĩa là artifact sẵn sàng cho đợt nghiệm thu. “Đạt” cần có kết quả ở testing. **Tiếp theo: P1, rồi P2.**

| ID | Phụ thuộc / phụ trách | Việc và đầu ra để bàn giao | Goal / bằng chứng | Trạng thái |
|---|---|---|---|---|
| P0 | Codex | Review proposal, tạo feature AI DevKit, ghi goals, backlog và kế hoạch nghiệm thu | G0 / năm tài liệu feature | Đã lập kế hoạch |
| P1 · H0 | P0 / maintainer + Codex | Chọn repo mẫu được phép, task thường và bug, lệnh kiểm tra, human review, dữ liệu/provider được phép. Ghi phiên bản, auth/billing đã che thông tin nhạy cảm, rule thực nạp, khả năng session, cấu hình hiệu lực và các ô chưa biết vào implementation. Chốt diff tối thiểu và ước lượng sau kiểm kê. | G0 / ma trận và tiêu chí task | Chờ làm |
| P2 · H1 | P1 / Codex | Dùng entry native, thêm phần policy thiếu cho solo, risk và quyết định trọng yếu. Ghi cách vào mode, cách resume, xử lý developer edit, kết quả check và manual rollback. Chuẩn bị task mẫu và cấu hình tốt trước đó cho N1. | G1–G2 / N1 | Chờ làm |
| P3 · H2 | P2 và có phạm vi dữ liệu B / Codex | Chọn phương pháp capture, materialize và đối chiếu snapshot. Chuẩn bị reviewer prompt, contract finding, evidence v2, stale check, giới hạn R0–F1–R1 và fixture cho N2. | G3 / N2 | Tùy chọn |
| P4 · H3 | P3 và có task cần chọn thiết kế, đã cho phép C / Codex | Dùng một plan AI DevKit có revision, challenge từ cùng worker, một lần revise mặc định và fresh review. Chuẩn bị phương án resume hoặc bàn giao thủ công cho N3. | G4 / N3 | Tùy chọn |
| P5 · nghiệm thu | P2 + các hạng mục tùy chọn đã chuẩn bị / maintainer + người kiểm thử | Chốt candidate, chạy một đợt theo testing, ghi từng gate và quyết định bàn giao. Nếu chỉ giao H1, N1 đủ cho phạm vi này. | G0–G4 theo phạm vi / N1–N3 | Chờ làm |
| P6 · quyết định giữ B/C | N2 đạt cho B, N3 đạt cho C / chủ dự án + người chấm độc lập | Chốt ngân sách và ngưỡng trước lượt đo, chạy V1 khi được phép, quyết định giữ, sửa hoặc hoãn theo nhóm task. | G5 / báo cáo pilot | Chờ điều kiện |

**H4.** Chỉ mở một plan mới cho Jev ASSESS khi đánh giá độc lập chứng minh lợi ích vượt cả quy tắc cố định lẫn quy tắc kết hợp suy luận native. Acceptance gồm tư vấn hợp lệ, biết từ chối khi thiếu dữ liệu, fallback khi timeout và giữ nguyên quyền quyết định của developer.

**H5.** Chỉ mở khi có nhu cầu tự động kích hoạt release và có publisher đáng tin cậy. Acceptance gồm ghim cấu hình theo phiên hoặc chỉ đổi lúc idle, nhận biết candidate lỗi thời và khôi phục cấu hình trước mà bảo toàn task đang chạy.

**Quy tắc điều phối.** Khi xong một hạng mục, Codex ghi artifact và hạng mục kế tiếp tại đây. Maintainer ghi kết quả nghiệm thu vào testing. Việc tùy chọn chưa đủ điều kiện giữ trạng thái riêng để H1 vẫn có thể bàn giao.
