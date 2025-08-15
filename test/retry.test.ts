/* eslint-disable no-console */
import * as delay from 'delay';
import type { Sequelize } from 'sequelize';
import { mockSequelize } from './helpers/mock-sequelize';

import { Agenda } from '../src';

let agenda: Agenda;
let sequelize: Sequelize;

const clearJobs = async (): Promise<void> => {
  if (sequelize) {
    await sequelize.model('AgendaJobs').destroy({ where: {} });
  }
};

const jobType = 'do work';
const jobProcessor = () => {};

describe('Retry', () => {
  beforeEach(async () => {
    if (!sequelize) {
      const mockedSequelize = await mockSequelize();
      sequelize = mockedSequelize.sequelize;
    }

    return new Promise(resolve => {
      agenda = new Agenda(
        {
          sequelize
        },
        async () => {
          await delay(50);
          await clearJobs();
          agenda.define('someJob', jobProcessor);
          agenda.define('send email', jobProcessor);
          agenda.define('some job', jobProcessor);
          agenda.define(jobType, jobProcessor);
          return resolve();
        }
      );
    });
  });

  afterEach(async () => {
    await delay(50);
    await agenda.stop();
    await clearJobs();
  });

  it('should retry a job', async () => {
    let shouldFail = true;

    agenda.processEvery(100); // Shave 5s off test runtime :grin:
    agenda.define('a job', (_job, done) => {
      if (shouldFail) {
        shouldFail = false;
        return done(new Error('test failure'));
      }

      done();
      return undefined;
    });

    agenda.on('fail:a job', (err, job) => {
      if (err) {
        // Do nothing as this is expected to fail.
      }

      job.schedule('now').save();
    });

    const successPromise = new Promise(resolve => {
      agenda.on('success:a job', resolve);
    });

    await agenda.now('a job');

    await agenda.start();
    await successPromise;
  }).timeout(100000);
});
