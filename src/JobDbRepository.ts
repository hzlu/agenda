/* eslint-disable max-classes-per-file */
/* eslint-disable @typescript-eslint/no-empty-interface */
/* eslint-disable @typescript-eslint/lines-between-class-members */
import * as debug from 'debug';
import { Sequelize, DataTypes, Model } from 'sequelize';
import type { Job, JobWithId } from './Job';
import type { Agenda } from './index';
import type {
  IDatabaseOptions,
  IDbConfig,
  ISequelizeOptions,
  Filter,
  Sort
} from './types/DbOptions';
import type { IJobParameters } from './types/JobParameters';
import {
  convertMongoFilterToSequelizeWhere,
  convertMongoSortToSequelizeOrder
} from './utils/filterToWhere';

const log = debug('agenda:db');

// 定义创建时的属性（可选字段）
interface IJobCreationAttributes extends Omit<IJobParameters, '_id'> {}

// 定义模型类
class AgendaJob extends Model<IJobParameters, IJobCreationAttributes> {
  public _id: string;
  public name: string;
  public priority: number;
  public nextRunAt: Date | null;
  public type: 'normal' | 'single';
  public lockedAt?: Date | null;
  public lastFinishedAt?: Date;
  public failedAt?: Date;
  public failCount?: number;
  public failReason?: string;
  public repeatTimezone?: string;
  public lastRunAt?: Date;
  public repeatInterval?: string | number;
  public data: unknown | void;
  public repeatAt?: string;
  public disabled?: boolean;
  public progress?: number;
  public lastModifiedBy?: string;
  /** forks a new node sub process for executing this job */
  public fork?: boolean;
}
/**
 * @class
 */
export class JobDbRepository {
  collection: typeof AgendaJob;

  constructor(
    private agenda: Agenda,
    private connectOptions: (IDatabaseOptions | ISequelizeOptions) & IDbConfig
  ) {
    this.connectOptions.sort = this.connectOptions.sort || { nextRunAt: 1, priority: -1 };
  }

  private async createConnection(): Promise<Sequelize> {
    const { connectOptions } = this;
    if (this.hasDatabaseConfig(connectOptions)) {
      log('using database config', connectOptions);
      return this.database(connectOptions.db);
    }

    if (this.hasMongoConnection(connectOptions)) {
      log('using passed in mongo connection');
      return connectOptions.sequelize;
    }

    throw new Error('invalid db config, or db config not found');
  }

  private hasMongoConnection(connectOptions: unknown): connectOptions is ISequelizeOptions {
    return !!(connectOptions as ISequelizeOptions)?.sequelize;
  }

  private hasDatabaseConfig(connectOptions: unknown): connectOptions is IDatabaseOptions {
    return !!(connectOptions as IDatabaseOptions)?.db?.host;
  }

  async getJobById(id: string) {
    return this.collection.findByPk(id);
  }

  async getJobs(
    query: Filter<IJobParameters>,
    sort: Sort = {},
    limit = 0,
    skip = 0
  ): Promise<IJobParameters[]> {
    const jobs = await this.collection.findAll({
      where: convertMongoFilterToSequelizeWhere(query),
      offset: skip,
      order: convertMongoSortToSequelizeOrder(sort),
      limit
    });
    return jobs.map(j => j.toJSON());
  }

  async removeJobs(query: Filter<IJobParameters>): Promise<number> {
    const result = await this.collection.destroy({
      where: convertMongoFilterToSequelizeWhere(query)
    });
    return result || 0;
  }

  async getQueueSize(): Promise<number> {
    const query = { nextRunAt: { $lt: new Date() } };
    return this.collection.count({
      where: convertMongoFilterToSequelizeWhere(query)
    });
  }

  async unlockJob(job: Job): Promise<void> {
    // only unlock jobs which are not currently processed (nextRunAT is not null)
    const query = { _id: job.attrs._id, nextRunAt: { $ne: null } };
    const item = await this.collection.findOne({
      where: convertMongoFilterToSequelizeWhere(query)
    });
    if (item) {
      await item.update({ lockedAt: null });
    }
  }

  /**
   * Internal method to unlock jobs so that they can be re-run
   */
  async unlockJobs(jobIds: string[]): Promise<void> {
    const query = { _id: { $in: [...new Set(jobIds)] }, nextRunAt: { $ne: null } };
    await this.collection.update(
      { lockedAt: null },
      {
        where: convertMongoFilterToSequelizeWhere(query)
      }
    );
  }

  async lockJob(job: JobWithId): Promise<IJobParameters | undefined> {
    // Query to run against collection to see if we need to lock it
    const criteria: Filter<Omit<IJobParameters, 'lockedAt'> & { lockedAt?: Date | null }> = {
      _id: job.attrs._id,
      name: job.attrs.name,
      lockedAt: null,
      nextRunAt: job.attrs.nextRunAt,
      disabled: { $ne: true }
    };

    const item = await this.collection.findOne({
      where: convertMongoFilterToSequelizeWhere(criteria)
    });
    if (item) {
      await item.update({
        lockedAt: new Date()
      });
    }
    return item?.toJSON() || undefined;
  }

  async getNextJobToRun(
    jobName: string,
    nextScanAt: Date,
    lockDeadline: Date,
    now: Date = new Date()
  ): Promise<IJobParameters | undefined> {
    /**
     * Query used to find job to run
     */
    const JOB_PROCESS_WHERE_QUERY1: Filter<IJobParameters /* Omit<IJobParameters, 'lockedAt'> & { lockedAt?: Date | null } */> =
      {
        name: jobName,
        disabled: { $ne: true },
        lockedAt: { $eq: null as any },
        nextRunAt: { $lte: nextScanAt }
      };
    const JOB_PROCESS_WHERE_QUERY2: Filter<IJobParameters /* Omit<IJobParameters, 'lockedAt'> & { lockedAt?: Date | null } */> =
      {
        name: jobName,
        disabled: { $ne: true },
        lockedAt: { $lte: lockDeadline }
      };

    let item = await this.collection.findOne({
      where: convertMongoFilterToSequelizeWhere(JOB_PROCESS_WHERE_QUERY1),
      order: [
        ['priority', 'desc'],
        ['lockedAt', 'asc'],
        ['nextRunAt', 'asc']
      ]
    });
    if (!item) {
      item = await this.collection.findOne({
        where: convertMongoFilterToSequelizeWhere(JOB_PROCESS_WHERE_QUERY2),
        order: [
          ['priority', 'desc'],
          ['lockedAt', 'asc'],
          ['nextRunAt', 'asc']
        ]
      });
    }
    if (item) {
      await item.update({
        lockedAt: now
      });
    }
    return item?.toJSON() || undefined;
  }

  async connect(): Promise<void> {
    const db = await this.createConnection();
    await db.authenticate();
    log('successful connection to Sequelize');

    const modelName = this.connectOptions.db?.modelName || 'AgendaJobs';
    if (!db.isDefined(modelName)) {
      this.collection = db.define(
        modelName,
        {
          _id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
            allowNull: false
          },
          name: {
            type: DataTypes.STRING,
            allowNull: false
          },
          priority: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
          },
          nextRunAt: {
            field: 'next_run_at',
            type: DataTypes.DATE(3)
          },
          type: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'normal'
          },
          lockedAt: {
            field: 'locked_at',
            type: DataTypes.DATE(3)
          },
          lastFinishedAt: {
            field: 'last_finished_at',
            type: DataTypes.DATE(3)
          },
          failedAt: {
            field: 'failed_at',
            type: DataTypes.DATE(3)
          },
          failCount: {
            field: 'fail_count',
            type: DataTypes.INTEGER
          },
          failReason: {
            field: 'fail_reason',
            type: DataTypes.TEXT
          },
          repeatTimezone: {
            field: 'repeat_timezone',
            type: DataTypes.STRING
          },
          lastRunAt: {
            field: 'last_run_at',
            type: DataTypes.DATE(3)
          },
          repeatInterval: {
            field: 'repeat_interval',
            type: DataTypes.STRING
          },
          data: {
            type: DataTypes.JSON
          },
          repeatAt: {
            field: 'repeat_at',
            type: DataTypes.STRING
          },
          disabled: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
          },
          progress: {
            type: DataTypes.INTEGER
          },
          lastModifiedBy: {
            field: 'last_modified_by',
            type: DataTypes.STRING
          },
          fork: {
            type: DataTypes.BOOLEAN
          }
        },
        {
          indexes: [
            {
              fields: ['name']
            },
            {
              fields: ['priority']
            },
            {
              fields: ['locked_at']
            },
            {
              fields: ['next_run_at']
            },
            {
              fields: ['disabled']
            }
          ]
        }
      );
      try {
        await db.sync();
      } catch (err: unknown) {
        log(`sync err ${(err as Error).message}`);
      }
      log('successful sync done');
    } else {
      this.collection = db.model(modelName) as typeof AgendaJob;
    }

    if (log.enabled) {
      log(
        `connected with collection: ${modelName}, collection size: ${
          typeof this.collection.count === 'function' ? await this.collection.count() : '?'
        }`
      );
    }

    this.agenda.emit('ready');
  }

  private async database(options: IDatabaseOptions['db']) {
    return new Sequelize({ ...options });
  }

  private processDbResult<DATA = unknown | void>(
    job: Job<DATA>,
    res?: IJobParameters<DATA>
  ): Job<DATA> {
    log(
      'processDbResult() called with success, checking whether to process job immediately or not'
    );

    // We have a result from the above calls
    if (res) {
      // Grab ID and nextRunAt from MongoDB and store it as an attribute on Job
      job.attrs._id = res._id;
      job.attrs.nextRunAt = res.nextRunAt;

      // check if we should process the job immediately
      this.agenda.emit('processJob', job);
    }

    // Return the Job instance
    return job;
  }

  async saveJobState(job: Job<any>): Promise<void> {
    const id = job.attrs._id;
    const $set: any = {
      lockedAt: (job.attrs.lockedAt && new Date(job.attrs.lockedAt)) || null,
      nextRunAt: (job.attrs.nextRunAt && new Date(job.attrs.nextRunAt)) || null,
      lastRunAt: (job.attrs.lastRunAt && new Date(job.attrs.lastRunAt)) || null,
      progress: job.attrs.progress,
      failReason: job.attrs.failReason,
      failCount: job.attrs.failCount,
      failedAt: job.attrs.failedAt && new Date(job.attrs.failedAt),
      lastFinishedAt: (job.attrs.lastFinishedAt && new Date(job.attrs.lastFinishedAt)) || null
    };

    log('[job %s] save job state: \n%O', id, $set);

    const query = { _id: id, name: job.attrs.name };
    const item = await this.collection.findOne({
      where: convertMongoFilterToSequelizeWhere(query)
    });
    if (item) {
      await item.update({
        ...$set
      });
    } else {
      throw new Error(
        `job ${id} (name: ${job.attrs.name}) cannot be updated in the database, maybe it does not exist anymore?`
      );
    }
  }

  /**
   * Save the properties on a job to MongoDB
   * @name Agenda#saveJob
   * @function
   * @param {Job} job job to save into MongoDB
   * @returns {Promise} resolves when job is saved or errors
   */
  async saveJob<DATA = unknown | void>(job: Job<DATA>): Promise<Job<DATA>> {
    try {
      log('attempting to save a job');

      // Grab information needed to save job but that we don't want to persist in MongoDB
      const id = job.attrs._id;

      // Store job as JSON and remove props we don't want to store from object
      // _id, unique, uniqueOpts
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _id, unique, uniqueOpts, ...props } = {
        ...job.toJson(),
        // Store name of agenda queue as last modifier in job data
        lastModifiedBy: this.agenda.attrs.name
      };

      log('[job %s] set job props: \n%O', id, props);

      // Grab current time and set default query options for MongoDB
      const now = new Date();
      log('current time stored as %s', now.toISOString());

      // If the job already had an ID, then update the properties of the job
      // i.e, who last modified it, etc
      if (id) {
        // Update the job and process the resulting data'
        log('job already has _id, calling findOneAndUpdate() using _id as query');
        const query = { _id: id, name: props.name };
        const item = await this.collection.findOne({
          where: convertMongoFilterToSequelizeWhere(query)
        });
        if (item) {
          await item.update({
            ...props
          });
          return this.processDbResult(job, item.toJSON() as IJobParameters<DATA>);
        }
        return this.processDbResult(job, undefined);
      }

      if (props.type === 'single') {
        // Job type set to 'single' so...
        log('job with type of "single" found');

        // Try an upsert
        log(
          `calling findOneAndUpdate(${props.name}) with job name and type of "single" as query`,
          (
            await this.collection.findOne({
              where: {
                name: props.name,
                type: 'single'
              },
              order: [
                ['priority', 'desc'],
                ['lockedAt', 'asc'],
                ['nextRunAt', 'asc']
              ]
            })
          )?.toJSON()
        );
        // this call ensure a job of this name can only exists once
        const query = { name: props.name, type: 'single' };
        const [item, isNew] = await this.collection.findOrCreate({
          where: convertMongoFilterToSequelizeWhere(query),
          defaults: {
            ...query,
            ...props
          }
        });
        if (isNew) {
          await item.update({ ...props });
          log(`findOneAndUpdate(${props.name}) with type "single" inserted new entry`);
        } else {
          // If the nextRunAt time is older than the current time, "protect" that property, meaning, don't change
          // a scheduled job's next run time!
          if (props.nextRunAt && props.nextRunAt <= now) {
            log('job has a scheduled nextRunAt time, protecting that field from upsert');
            delete (props as Partial<IJobParameters>).nextRunAt;
          }

          await item.update({ ...props });
          log(`findOneAndUpdate(${props.name}) with type "single" updated existing entry`);
        }
        return this.processDbResult(job, item.toJSON() as IJobParameters<DATA>);
      }

      // If all else fails, the job does not exist yet so we just insert it into MongoDB
      log(
        'using default behavior, inserting new job via insertOne() with props that were set: \n%O',
        props
      );
      const item = await this.collection.create({ ...props });
      return this.processDbResult(job, item.toJSON() as IJobParameters<DATA>);
    } catch (error) {
      log('processDbResult() received an error, job was not updated/created');
      throw error;
    }
  }
}
