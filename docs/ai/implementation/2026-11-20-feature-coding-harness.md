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
| Codex | Shell đã tìm thấy executable trong lần kiểm kê ban đầu. | Kiểm tra phiên bản, entry, model thực, auth/billing, khả năng nhận diện worker và chỉ dẫn effective. |
| Claude, isolation, AI DevKit session | Chưa xác minh trên repo mẫu. | Ghi rõ supported/tested, unsupported hoặc unknown. Chỉ mở B/C khi phạm vi dữ liệu và quyền cho phép. |
| Repo thử, checks, review bắt buộc | Chưa chọn. Workspace hiện chứa tài liệu harness. | Maintainer chọn repo/fixture, chốt baseline, acceptance và phạm vi ghi. |

## Thứ tự dùng trong một task

1. Đọc yêu cầu, policy của repo đích, baseline và diff đang có. Ghi mode, quyền, quyết định còn mở và tiêu chí chấp nhận. Mặc định A. Giữ công việc ngoài task của developer.
2. Với C, Claude xuất một plan có revision. Codex kiểm chứng symbol, contract và quyết định trọng yếu, trả `accept`, `revise` hoặc `blocked`. Tiếp tục cùng worker sau khi accept.
3. Codex triển khai và chạy affected checks của task trên source hiện tại. Ghi command, exit status, môi trường và tham chiếu output. Việc gom test nghiệm thu harness không làm thay đổi nghĩa vụ chạy checks của repo đích.
4. Với B/C, ưu tiên revision bất biến. Nếu có thay đổi chưa commit, dùng temporary index trên workspace sạch đối với phạm vi task, đối chiếu baseline, tree, file mới/xóa, mode, symlink và nội dung đã materialize. Bảo toàn real index. Từ chối input liên quan thiếu identity, source đổi hoặc layout chưa hỗ trợ. Cấp reviewer quyền trên bản đã kiểm tra.
5. Phiên reviewer mới nhận yêu cầu gốc, policy, snapshot/diff và test evidence. Ghi `snapshotId`, paths thực đọc, limitations, finding có location/evidence/expected behavior. Kết quả hợp lệ là `no_blocking_findings`, `changes_required` kèm blocker, hoặc `insufficient_evidence`. F1 dùng hết lượt sửa ngay khi bắt đầu. R1 gắn snapshot mới sau affected checks. Blocker còn lại được báo cho developer.
6. Báo tất cả gate còn mở. Ưu tiên `failed_verification` khi required check đã chạy và fail, sau đó `blocked` khi hết đường tiến, `review_required` khi chờ review, cuối cùng `verified` khi đủ bằng chứng hiện hành. Acceptance của người dùng được ghi riêng.
7. Ghi TaskEvidence v2 tối thiểu khi được phép gồm mode/source, risk, revision, snapshot, role/provider/model thực, refs và outcome. Để unknown cho dữ liệu thiếu, tránh đếm đôi khi resume. Lỗi ghi telemetry chỉ ảnh hưởng khả năng so sánh. Khi bàn giao release, ghi commit, effective config và revision tốt trước đó. Kích hoạt hoặc rollback lúc idle.

**Khi gián đoạn**, kiểm tra worker thực trước khi retry, đọc lại yêu cầu và source sau compaction. Gặp external edit thì dừng ghi phần liên quan, hòa giải và chạy lại affected checks. Gặp xung đột DB/cache/port thì cô lập hoặc tạm dừng. Thiếu quota hoặc quyền thì giữ nguyên công việc và báo bước cần để tiếp tục.
