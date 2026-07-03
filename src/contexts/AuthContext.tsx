import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { User, UserRole, AuthState } from '@/types';

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<boolean>;
  signup: (name: string, email: string, password: string) => Promise<boolean>;
  loginWithGoogle: () => Promise<boolean>;
  logout: () => void;
  setDevRole: (role: UserRole) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const USERS_DB_KEY = 'image_ai_users_db';
const STORAGE_KEY = 'image_ai_auth';

// Helper to load or initialize the mock users DB
const loadMockUsersDB = (): Record<string, User & { password?: string }> => {
  const saved = localStorage.getItem(USERS_DB_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // Revive dates
      for (const key in parsed) {
        if (parsed[key].createdAt) {
          parsed[key].createdAt = new Date(parsed[key].createdAt);
        }
      }
      return parsed;
    } catch {
      // Continue to default
    }
  }
  
  // Default demo users
  const defaultUsers = {
    'admin@demo.com': {
      id: 'admin-1',
      email: 'admin@demo.com',
      name: 'Admin User',
      role: 'admin' as UserRole,
      password: 'admin123',
      createdAt: new Date('2024-01-01'),
      status: 'active' as const,
    },
    'user@demo.com': {
      id: 'user-1',
      email: 'user@demo.com',
      name: 'Demo User',
      role: 'user' as UserRole,
      password: 'user123',
      createdAt: new Date('2024-06-01'),
      status: 'active' as const,
    },
  };
  
  localStorage.setItem(USERS_DB_KEY, JSON.stringify(defaultUsers));
  return defaultUsers;
};

const saveMockUsersDB = (db: Record<string, User & { password?: string }>) => {
  localStorage.setItem(USERS_DB_KEY, JSON.stringify(db));
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });

  // Load saved session on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setState({
          user: { ...parsed, createdAt: new Date(parsed.createdAt) },
          isAuthenticated: true,
          isLoading: false,
        });
      } catch {
        setState({ user: null, isAuthenticated: false, isLoading: false });
      }
    } else {
      setState({ user: null, isAuthenticated: false, isLoading: false });
    }
  }, []);

  const saveUser = useCallback((user: User) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    setState({ user, isAuthenticated: true, isLoading: false });
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 800));

    const db = loadMockUsersDB();
    const mockUser = db[email.toLowerCase()];
    if (mockUser && mockUser.password === password) {
      if (mockUser.status === 'disabled') {
        return false;
      }
      
      const { password: _, ...user } = mockUser;
      saveUser(user as User);
      return true;
    }
    return false;
  }, [saveUser]);

  const signup = useCallback(async (name: string, email: string, password: string): Promise<boolean> => {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 800));

    const db = loadMockUsersDB();

    // Check if user already exists
    if (db[email.toLowerCase()]) {
      return false;
    }

    // Create new user
    const newUser: User = {
      id: `user-${Date.now()}`,
      email,
      name,
      role: 'user',
      createdAt: new Date(),
      status: 'active',
    };

    db[email.toLowerCase()] = { ...newUser, password };
    saveMockUsersDB(db);
    saveUser(newUser);
    return true;
  }, [saveUser]);

  const loginWithGoogle = useCallback(async (): Promise<boolean> => {
    // Simulate OAuth delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    const db = loadMockUsersDB();
    const email = 'google.user@gmail.com';

    let googleUser = db[email] as User;
    if (!googleUser) {
        googleUser = {
          id: `google-${Date.now()}`,
          email,
          name: 'Google User',
          role: 'user',
          avatarUrl: 'https://lh3.googleusercontent.com/a/default-user',
          createdAt: new Date(),
          status: 'active',
        };
        db[email] = googleUser;
        saveMockUsersDB(db);
    }

    saveUser(googleUser);
    return true;
  }, [saveUser]);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState({ user: null, isAuthenticated: false, isLoading: false });
  }, []);

  // Dev helper to switch roles
  const setDevRole = useCallback((role: UserRole) => {
    if (state.user) {
      const updatedUser = { ...state.user, role };
      saveUser(updatedUser);
    } else {
      // Create a guest with the specified role for demo purposes
      const demoUser: User = {
        id: `demo-${Date.now()}`,
        email: `${role}@demo.local`,
        name: `Demo ${role.charAt(0).toUpperCase() + role.slice(1)}`,
        role,
        createdAt: new Date(),
        status: 'active',
      };
      saveUser(demoUser);
    }
  }, [state.user, saveUser]);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        signup,
        loginWithGoogle,
        logout,
        setDevRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
