import { ModelInfo, SystemMetrics, AuditLog, User, UserRole, AuditAction } from '@/types';

// Mock model status data
const mockModels: ModelInfo[] = [
  {
    id: 'enhancement-v1',
    name: 'Enhancement Model (CNN+GAN)',
    type: 'enhancement',
    status: 'online',
    uptime: 99.9,
    lastHeartbeat: new Date(Date.now() - 5000),
    version: '2.4.1',
  },
  {
    id: 'segmentation-v1',
    name: 'Segmentation Model (U-Net)',
    type: 'segmentation',
    status: 'online',
    uptime: 99.7,
    lastHeartbeat: new Date(Date.now() - 3000),
    version: '1.8.0',
  },
  {
    id: 'security-v1',
    name: 'Security Module (AES-256)',
    type: 'security',
    status: 'online',
    uptime: 100,
    lastHeartbeat: new Date(Date.now() - 1000),
    version: '3.0.2',
  },
];

const USERS_DB_KEY = 'image_ai_users_db';

const getLocalUsersDB = (): Record<string, User & { password?: string }> => {
  const saved = localStorage.getItem(USERS_DB_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      for (const key in parsed) {
        if (parsed[key].createdAt) {
          parsed[key].createdAt = new Date(parsed[key].createdAt);
        }
      }
      return parsed;
    } catch {
      return {};
    }
  }
  return {};
};

const saveLocalUsersDB = (db: Record<string, User & { password?: string }>) => {
  localStorage.setItem(USERS_DB_KEY, JSON.stringify(db));
};

// Generate mock audit logs
function generateMockAuditLogs(): AuditLog[] {
  const actions: AuditAction[] = ['login', 'upload', 'run', 'download', 'share', 'logout'];
  const logs: AuditLog[] = [];
  const now = Date.now();
  const db = getLocalUsersDB();

  for (let i = 0; i < 50; i++) {
    const userKeys = Object.keys(db);
    if (!userKeys.length) break;
    const user = db[userKeys[Math.floor(Math.random() * userKeys.length)]];
    const action = actions[Math.floor(Math.random() * actions.length)];
    const timestamp = new Date(now - i * 15 * 60 * 1000 - Math.random() * 30 * 60 * 1000);

    logs.push({
      id: `log-${i}`,
      timestamp,
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action,
      jobId: ['upload', 'run', 'download', 'share'].includes(action) 
        ? `job-${Math.random().toString(36).substr(2, 9)}` 
        : undefined,
      details: getActionDetails(action),
      ipAddress: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
    });
  }

  return logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

function getActionDetails(action: AuditAction): string {
  switch (action) {
    case 'login': return 'User logged in successfully';
    case 'logout': return 'User logged out';
    case 'upload': return 'Image uploaded for processing';
    case 'run': return 'Processing pipeline executed';
    case 'download': return 'Processed image downloaded';
    case 'share': return 'Share link generated';
    case 'delete': return 'Item deleted from vault';
    case 'role_change': return 'User role updated';
    case 'user_disable': return 'User account disabled';
    default: return '';
  }
}

let cachedLogs: AuditLog[] | null = null;

export const adminService = {
  async getModelStatus(): Promise<ModelInfo[]> {
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Randomly update heartbeats
    return mockModels.map(model => ({
      ...model,
      lastHeartbeat: new Date(Date.now() - Math.random() * 10000),
    }));
  },

  async getSystemMetrics(): Promise<SystemMetrics> {
    await new Promise(resolve => setTimeout(resolve, 200));

    return {
      queueLength: Math.floor(Math.random() * 5),
      avgProcessingTime: 3.5 + Math.random() * 2,
      errorRate: Math.random() * 0.5,
      totalJobsToday: Math.floor(150 + Math.random() * 100),
      activeUsers: Math.floor(20 + Math.random() * 30),
    };
  },

  async getAuditLogs(filters?: {
    startDate?: Date;
    endDate?: Date;
    action?: AuditAction;
    userId?: string;
  }): Promise<AuditLog[]> {
    await new Promise(resolve => setTimeout(resolve, 400));

    if (!cachedLogs) {
      cachedLogs = generateMockAuditLogs();
    }

    let logs = [...cachedLogs];

    if (filters) {
      if (filters.startDate) {
        logs = logs.filter(log => log.timestamp >= filters.startDate!);
      }
      if (filters.endDate) {
        logs = logs.filter(log => log.timestamp <= filters.endDate!);
      }
      if (filters.action) {
        logs = logs.filter(log => log.action === filters.action);
      }
      if (filters.userId) {
        logs = logs.filter(log => log.actorId === filters.userId);
      }
    }

    return logs;
  },

  async getUsers(): Promise<User[]> {
    await new Promise(resolve => setTimeout(resolve, 300));
    const db = getLocalUsersDB();
    // Return all users as an array, sorting to put newest users first
    return Object.values(db).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  },

  async updateUserRole(userId: string, newRole: UserRole): Promise<boolean> {
    await new Promise(resolve => setTimeout(resolve, 400));
    const db = getLocalUsersDB();
    const emailKey = Object.keys(db).find(key => db[key].id === userId);
    
    if (emailKey) {
      db[emailKey].role = newRole;
      saveLocalUsersDB(db);
      
      // Update running session if current user
      const currentUserStr = localStorage.getItem('image_ai_auth');
      if (currentUserStr) {
        try {
          const cu = JSON.parse(currentUserStr);
          if (cu.id === userId) {
            cu.role = newRole;
            localStorage.setItem('image_ai_auth', JSON.stringify(cu));
            // Reload page to rehydrate context securely
            window.location.reload();
          }
        } catch {
          return false;
        }
      }
      return true;
    }
    return false;
  },

  async updateUserStatus(userId: string, status: 'active' | 'disabled'): Promise<boolean> {
    await new Promise(resolve => setTimeout(resolve, 400));
    const db = getLocalUsersDB();
    const emailKey = Object.keys(db).find(key => db[key].id === userId);
    
    if (emailKey) {
      db[emailKey].status = status;
      saveLocalUsersDB(db);

      // Force logout if we are disabling the current actively logged-in user
      const currentUserStr = localStorage.getItem('image_ai_auth');
      if (currentUserStr) {
        try {
          const cu = JSON.parse(currentUserStr);
          if (cu.id === userId && status === 'disabled') {
            localStorage.removeItem('image_ai_auth');
            window.location.href = '/login';
          }
        } catch {
          return false;
        }
      }
      return true;
    }
    return false;
  },
};
