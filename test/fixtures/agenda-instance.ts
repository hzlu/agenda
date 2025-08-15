import * as dmdb from 'dmdb';
import { Agenda } from '../../src';
import addTests from './add-tests';

const tests = process.argv.slice(2);

const agenda = new Agenda(
  {
    db: {
      host: '192.168.0.122',
      port: 30236,
      database: 'hscloud',
      username: 'hscloud',
      password: 'Huasi88888888',
      dialect: 'dmdb',
      dialectModule: dmdb,
      timezone: '+08:00',
      modelName: 'AgendaJobs'
    },
    processEvery: 100
  },
  async () => {
    tests.forEach(test => {
      addTests[test](agenda);
    });

    await agenda.start();

    // Ensure we can shut down the process from tests
    process.on('message', msg => {
      if (msg === 'exit') {
        process.exit(0);
      }
    });

    // Send default message of "notRan" after 400ms
    setTimeout(() => {
      process.send!('notRan');
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(0);
    }, 4000);
  }
);
