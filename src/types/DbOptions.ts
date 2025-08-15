import type { Sequelize } from 'sequelize';

export interface IDatabaseOptions {
  db: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    dialect: 'dmdb';
    dialectModule: any;
    timezone: string;
    modelName?: string;
    logging?: any;
  };
}

export interface ISequelizeOptions {
  db?: {
    modelName?: string;
  };
  sequelize: Sequelize;
}

export type Sort = { [key: string]: 1 | -1 | 'asc' | 'desc' };

export interface IDbConfig {
  ensureIndex?: boolean;
  sort?: Sort;
}

export type Filter<TSchema> =
  | Partial<TSchema>
  | ({
      [P in keyof TSchema]?:
        | {
            $in?: string[];
            $nin?: string[];
            $gt?: number | Date;
            $lt?: number | Date;
            $ne?: any;
          }
        | any;
    } & {
      [key: string]: any;
    });
