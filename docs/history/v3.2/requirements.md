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

Jev, tự động kích hoạt release và hệ thống đánh giá ngoài runtime chỉ xem xét theo điều kiện ở planning. H1 CLI trong phạm vi được người dùng chọn đã được triển khai và kiểm thử; kết quả và giới hạn xem testing. G3–G5 tiếp tục có điều kiện theo P3/P4/P6.

## Development workflow được chọn bổ sung

Ngày 20/11/2026, chủ dự án xác nhận dùng bộ .codex từ working-after-limit để phát triển harness theo approved plan. Acceptance của cấu hình gồm ba role đúng model/effort, tham chiếu file hợp lệ, bàn giao implementer → unit_tester → code_reviewer tuần tự và giữ AI DevKit planning làm backlog chính. Nghiệm thu discovery và thực thi ba role được gom vào P5. Các goal runtime G1–G5 tiếp tục theo phạm vi mode tương ứng.

## Phạm vi chốt bàn giao H1

Người dùng chọn nghiệm thu CLI đã kiểm với MCP/plugins tắt, ghi rõ giới hạn còn lại. Phạm vi này dùng native local tools và AI DevKit docs, không yêu cầu tương thích với cấu hình MCP cá nhân. Đây là điểm dừng H1 cho bản bàn giao hiện tại. Việc mở B/C cần quyết định riêng theo điều kiện đã ghi trong planning.

## Phạm vi P3 được mở

Sau H1, người dùng giao triển khai tiếp và chọn chuẩn bị H2 local, chưa gọi Claude. Bản giao local có snapshot có thể đối chiếu, skill/handoff contract và test regression nhóm. G3 runtime giữ trạng thái chưa đạt cho tới N2 live có quyền phù hợp. Thay đổi này không mở quyền cài CLI hoặc gửi source.

P3 local đã hoàn tất các artifact được chọn, suite và final review đạt. Goal G3 runtime chưa được đánh dấu đạt; live review cần quyết định quyền dữ liệu/provider và nghiệm thu N2 riêng.

## Tiếp tục hoàn thiện

Bổ sung artifact Mode C local để hoàn thiện instruction pack. Lựa chọn không gọi/cài Claude còn hiệu lực, nên N2/N3 live và G3/G4 runtime chưa đạt. Việc có skill không tự cho phép cross-provider planning/review hoặc thay worker.

## Phạm vi nghiệm thu N2/N3 được chọn

Sau khi đã đăng nhập Pro, người dùng cho phép tiếp tục đợt synthetic. Guard, N2 review/fix/re-review và N3 planning/challenge/same-worker implementation/fresh review đã thực thi. Người dùng chọn chốt fixture, hoãn V1 và giữ B/C thử nghiệm. G3/G4 được ghi nhận trong phạm vi fixture đã kiểm; tính hữu ích/chất lượng/chi phí so với solo (G5) chưa có bằng chứng. Không mở rộng sang mọi repo/plugin hoặc tự bật B/C mặc định.

Phạm vi H1 CLI cùng N2/N3 functional synthetic fixture đã được triển khai và final review đạt sau sửa entry guard. V1/P6 hoãn theo quyết định rõ ràng của user, B/C giữ experimental. Hoàn tất phạm vi bàn giao này không khẳng định hiệu quả tương đối hoặc readiness cho mọi project.
