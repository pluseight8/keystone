import type { BackupInspection, SelectiveBackupPolicy } from '@keystone/core';

/** Native host boundary for encrypted backup files and recovery secret UI. */
export interface MobileBackupRuntime {
  status(): Promise<{ configured: boolean; lastBackup?: BackupInspection }>;
  exportBackup(policy?: SelectiveBackupPolicy): Promise<BackupInspection>;
  importBackup(): Promise<BackupInspection>;
  restoreBackup(): Promise<BackupInspection>;
}
