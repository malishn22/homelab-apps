export enum View {
  DASHBOARD = 'DASHBOARD',
  MODPACKS = 'MODPACKS',
  SERVERS = 'SERVERS',
  SETTINGS = 'SETTINGS'
}

export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  SUCCESS = 'SUCCESS'
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
}

export interface Modpack {
  id: string;
  slug?: string;
  title: string;
  description: string;
  author: string;
  downloads: string;
  downloadsCount?: number;
  followers?: string;
  followersCount?: number;
  updatedAt?: string;
  categories: string[];
  imageUrl: string;
  longDescription?: string;
  loaders?: string[];
  gameVersions?: string[];
  serverSide?: string;
}

export interface ServerVersionOption {
  id?: string;
  versionNumber?: string;
  gameVersions?: string[];
  loaders?: string[];
  datePublished?: string;
  serverSupported?: boolean;
}

export interface InstallRequestOptions {
  versionId?: string;
  versionNumber?: string;
  loaders?: string[];
  serverId?: string;
  createNew?: boolean;
  serverName?: string;
  serverPort?: number;
}

export interface ServerStats {
  ramUsage: number; // in GB
  ramTotal: number; // in GB
  cpuLoad: number; // percentage
  tps: number; // ticks per second
  status: 'ONLINE' | 'OFFLINE' | 'STARTING' | 'STOPPING' | 'MAINTENANCE';
}

export interface Server {
    id: string;
    name: string;
    type: string;
    version: string;
    port: number;
    status: 'ONLINE' | 'OFFLINE' | 'STARTING' | 'MAINTENANCE';
    players: number;
    maxPlayers: number;
    ramUsage: number;
    ramLimit: number;
}
