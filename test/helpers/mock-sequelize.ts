import * as dmdb from 'dmdb';
import { Sequelize } from 'sequelize';
import debug from 'debug';

const log = debug('agenda:mock-sequelize');

export interface IMockSequelize {
  disconnect: () => void;
  sequelize: Sequelize;
}

export async function mockSequelize(): Promise<IMockSequelize> {
  const self: IMockSequelize = {} as any;

  self.sequelize = new Sequelize({
    host: '192.168.0.122',
    port: 30236,
    database: 'hscloud',
    username: 'hscloud',
    password: 'Huasi88888888',
    dialect: 'dmdb',
    dialectModule: dmdb,
    timezone: '+08:00',
    logging: false
  });
  await self.sequelize.authenticate();
  log('sequelize started');
  self.disconnect = function () {
    self.sequelize.close();
    log('sequelize stopped');
  };

  return self;
}
