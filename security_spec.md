# Security Specification — ClearSlate Studio Firestore Rules

## 1. Data Invariants
- **Default Deny**: All paths not explicitly matched (`/restorationJobs/{jobId}`) are denied for read and write.
- **Verified Owner Identity**: Every `RestorationJob` document must have `ownerId == request.auth.uid` and `request.auth.token.email_verified == true`.
- **No Blanket Reads**: `get` and `list` operations on `/restorationJobs/{jobId}` strictly enforce `resource.data.ownerId == request.auth.uid`.
- **Strict Schema & Bounds**:
  - `jobId` must match `^[a-zA-Z0-9_\-]+$` and `size() <= 128`.
  - Required keys: `ownerId`, `fileName`, `source`, `width`, `height`, `regionCount`, `watermarkType`, `restorationMethod`, `status`, `createdAt`, `updatedAt`.
  - Optional key: `driveFileId`.
  - No shadow/unexpected fields (`hasOnly`).
  - `createdAt == request.time` on create; `createdAt` and `ownerId` are immutable on update; `updatedAt == request.time` on update.
- **Terminal State Gate**: Once `status == 'exported_drive'`, no further status regressions are permitted.

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write**: `auth == null` attempting to create `/restorationJobs/job_1`.
2. **Unverified Email Spoof**: `auth.uid == 'user_1'`, `email_verified == false` attempting to create `/restorationJobs/job_1`.
3. **Identity Spoofing on Create**: `auth.uid == 'user_1'` setting `ownerId: 'user_2'`.
4. **Shadow Field Injection on Create**: Adding `isAdmin: true` to `/restorationJobs/job_1`.
5. **ID Poisoning**: Document ID containing special characters or length > 128 (`job/../../bad`).
6. **Oversized String DoW**: `fileName` with 5,000 characters (> 255 max).
7. **Invalid Enum Value**: `source: 'external_bucket'` or `status: 'hacked'`.
8. **Forged Client Timestamp on Create**: `createdAt` not matching `request.time`.
9. **Owner Transfer on Update**: Updating `ownerId` from `'user_1'` to `'user_2'`.
10. **Immutable `createdAt` Mutation on Update**: Changing `createdAt` during an update.
11. **Terminal State Mutation**: Attempting to update a job whose `existing().status == 'exported_drive'`.
12. **Unauthorized Cross-User List/Get**: `auth.uid == 'user_2'` reading or listing documents where `resource.data.ownerId == 'user_1'`.
