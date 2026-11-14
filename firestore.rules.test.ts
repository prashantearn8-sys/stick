/**
 * Security Rules Specification Test Suite for /restorationJobs/{jobId}
 * Verifies that all 12 "Dirty Dozen" adversarial payloads return PERMISSION_DENIED.
 */

export interface DirtyDozenTestCase {
  id: number;
  name: string;
  auth: { uid: string; email_verified: boolean } | null;
  operation: 'create' | 'update' | 'get' | 'list' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const dirtyDozenTestSuite: DirtyDozenTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated create blocked',
    auth: null,
    operation: 'create',
    path: '/restorationJobs/job_1',
    payload: { ownerId: 'u1' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified email create blocked',
    auth: { uid: 'u1', email_verified: false },
    operation: 'create',
    path: '/restorationJobs/job_1',
    payload: { ownerId: 'u1' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Identity spoofing ownerId != auth.uid blocked',
    auth: { uid: 'u1', email_verified: true },
    operation: 'create',
    path: '/restorationJobs/job_1',
    payload: { ownerId: 'u2', fileName: 'a.png' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow field injection blocked by hasOnly',
    auth: { uid: 'u1', email_verified: true },
    operation: 'create',
    path: '/restorationJobs/job_1',
    payload: { ownerId: 'u1', shadowField: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'ID poisoning blocked by isValidId',
    auth: { uid: 'u1', email_verified: true },
    operation: 'create',
    path: '/restorationJobs/invalid$id!',
    payload: { ownerId: 'u1' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Oversized fileName (>255 chars) blocked',
    auth: { uid: 'u1', email_verified: true },
    operation: 'create',
    path: '/restorationJobs/job_1',
    payload: { ownerId: 'u1', fileName: 'x'.repeat(300) },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Invalid source enum blocked',
    auth: { uid: 'u1', email_verified: true },
    operation: 'create',
    path: '/restorationJobs/job_1',
    payload: { ownerId: 'u1', source: 's3' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Forged createdAt timestamp blocked',
    auth: { uid: 'u1', email_verified: true },
    operation: 'create',
    path: '/restorationJobs/job_1',
    payload: { ownerId: 'u1', createdAt: '1999-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Mutating immutable ownerId on update blocked',
    auth: { uid: 'u1', email_verified: true },
    operation: 'update',
    path: '/restorationJobs/job_1',
    payload: { ownerId: 'u2' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Mutating immutable createdAt on update blocked',
    auth: { uid: 'u1', email_verified: true },
    operation: 'update',
    path: '/restorationJobs/job_1',
    payload: { createdAt: '2025-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Updating terminal exported_drive status blocked',
    auth: { uid: 'u1', email_verified: true },
    operation: 'update',
    path: '/restorationJobs/job_terminal',
    payload: { status: 'detected' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Cross-user read/list blocked',
    auth: { uid: 'u2', email_verified: true },
    operation: 'get',
    path: '/restorationJobs/job_owned_by_u1',
    expectedResult: 'PERMISSION_DENIED',
  },
];
