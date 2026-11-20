---
phase: testing
title: Một đợt nghiệm thu chung
---

# Một đợt nghiệm thu chung

**Trạng thái: chưa chạy runtime.** Khi P2 và các mode thuộc phạm vi bàn giao đã chuẩn bị xong, mở một biên bản cho một candidate. Ghi commit, config/profile thực, môi trường, task fixture, phạm vi provider được duyệt và người chấm. Dùng fixture local để tạo các biến thể lỗi; chỉ gọi provider thật cho luồng đại diện đã được phép. Mỗi quan sát có thể phục vụ nhiều AC. Điều chưa quan sát phải ghi là chưa xác minh.

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
