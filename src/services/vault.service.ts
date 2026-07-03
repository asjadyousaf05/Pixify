import { VaultItem, Job } from '@/types';

type StoredJob = Omit<Job, 'createdAt' | 'updatedAt' | 'completedAt' | 'expiresAt'> & {
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  expiresAt?: string;
};

type StoredVaultItem = Omit<VaultItem, 'createdAt' | 'expiresAt' | 'job'> & {
  createdAt: string;
  expiresAt: string;
  job: StoredJob;
};

const getVaultStorageKey = (userId: string) => `image_ai_vault_${userId}`;

const getLocalVaultDB = (userId: string): VaultItem[] => {
  const saved = localStorage.getItem(getVaultStorageKey(userId));
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // Revive dates
      return (parsed as StoredVaultItem[]).map((item) => ({
        ...item,
        createdAt: new Date(item.createdAt),
        expiresAt: new Date(item.expiresAt),
        job: {
          ...item.job,
          originalImage: item.job.originalImage,
          createdAt: item.job.createdAt ? new Date(item.job.createdAt) : undefined,
          updatedAt: item.job.updatedAt ? new Date(item.job.updatedAt) : undefined,
          completedAt: item.job.completedAt ? new Date(item.job.completedAt) : undefined,
          expiresAt: item.job.expiresAt ? new Date(item.job.expiresAt) : undefined,
        }
      }));
    } catch {
      return [];
    }
  }
  return [];
};

const saveLocalVaultDB = (userId: string, items: VaultItem[]) => {
  localStorage.setItem(getVaultStorageKey(userId), JSON.stringify(items));
};

export const vaultService = {
  async getVaultItems(userId: string): Promise<VaultItem[]> {
    const items = getLocalVaultDB(userId);
    // Auto-clean expired items on load
    const validItems = items.filter(item => item.expiresAt > new Date());
    if (items.length !== validItems.length) {
      saveLocalVaultDB(userId, validItems);
    }
    return validItems;
  },

  async addToVault(userId: string, job: Job): Promise<VaultItem> {
    await new Promise(resolve => setTimeout(resolve, 200));

    const operations: ('enhancement' | 'background' | 'encryption')[] = [];
    if (job.settings.enhancement.enabled) operations.push('enhancement');
    if (job.settings.background.enabled) operations.push('background');
    if (job.settings.security.enabled) operations.push('encryption');

    const item: VaultItem = {
      id: `vault-${Date.now()}`,
      job,
      thumbnail: job.originalImage.url,
      operations,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };

    const items = getLocalVaultDB(userId);
    items.unshift(item);
    saveLocalVaultDB(userId, items);

    return item;
  },

  async deleteFromVault(userId: string, itemId: string): Promise<boolean> {
    const items = getLocalVaultDB(userId);
    const filtered = items.filter(item => item.id !== itemId);
    saveLocalVaultDB(userId, filtered);

    return true;
  },

  async generateShareLink(itemId: string, expiry: '1h' | '24h' | '7d'): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 400));

    const expiryMap = { '1h': 3600, '24h': 86400, '7d': 604800 };
    const expirySeconds = expiryMap[expiry];
    const token = btoa(`${itemId}-${Date.now()}-${expirySeconds}`).replace(/=/g, '');

    return `https://pixify.app/share/${token}`;
  },
};
