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
  categories: string[];
  imageUrl: string;
  longDescription?: string;
  loaders?: string[];
  gameVersions?: string[];
}

export interface ServerStats {
  ramUsage: number; // in GB
  ramTotal: number; // in GB
  cpuLoad: number; // percentage
  tps: number; // ticks per second
  status: 'ONLINE' | 'OFFLINE' | 'STARTING' | 'STOPPING';
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
