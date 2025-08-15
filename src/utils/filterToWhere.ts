/* eslint-disable no-restricted-syntax */
/* eslint-disable no-prototype-builtins */
import { Op } from 'sequelize';
import type { WhereOptions, Order } from 'sequelize';
import type { IJobParameters } from '../types/JobParameters';
import type { Filter, Sort } from '../types/DbOptions';

export function convertMongoFilterToSequelizeWhere(
  mongoFilter: Filter<IJobParameters>
): WhereOptions {
  const sequelizeWhere: WhereOptions = {};

  for (const key in mongoFilter) {
    if (mongoFilter.hasOwnProperty(key)) {
      const value = mongoFilter[key];

      // 处理链式点号
      const keys = key.split('.');
      let currentLevel = sequelizeWhere;

      keys.forEach((k, index) => {
        if (index === keys.length - 1) {
          // 最后一个键，处理值
          if (value instanceof Date) {
            currentLevel[k] = value;
          } else if (typeof value === 'object' && value !== null) {
            // 处理 MongoDB 的比较操作符
            if ('$eq' in value) {
              currentLevel[k] = { [Op.eq]: value.$eq };
            } else if ('$ne' in value) {
              currentLevel[k] = { [Op.ne]: value.$ne };
            } else if ('$gt' in value) {
              currentLevel[k] = { [Op.gt]: value.$gt };
            } else if ('$gte' in value) {
              currentLevel[k] = { [Op.gte]: value.$gte };
            } else if ('$lt' in value) {
              currentLevel[k] = { [Op.lt]: value.$lt };
            } else if ('$lte' in value) {
              currentLevel[k] = { [Op.lte]: value.$lte };
            } else if ('$in' in value) {
              currentLevel[k] = { [Op.in]: value.$in };
            } else if ('$nin' in value) {
              currentLevel[k] = { [Op.notIn]: value.$nin };
            } else if ('$regex' in value) {
              currentLevel[k] = { [Op.like]: `%${value.$regex}%` };
            } else {
              // 如果是嵌套的查询，递归处理
              currentLevel[k] = convertMongoFilterToSequelizeWhere(value);
            }
          } else {
            // 直接赋值
            currentLevel[k] = value;
          }
        } else {
          // 中间键，创建嵌套对象
          if (!currentLevel[k]) {
            currentLevel[k] = {};
          }
          currentLevel = currentLevel[k];
        }
      });
    }
  }

  return sequelizeWhere;
}

export function convertMongoSortToSequelizeOrder(mongoSort: Sort): Order {
  const sequelizeOrder: Order = [];

  for (const key in mongoSort) {
    if (mongoSort.hasOwnProperty(key)) {
      const direction = mongoSort[key];
      if (direction === 1) {
        sequelizeOrder.push([key, 'ASC']);
      } else if (direction === -1) {
        sequelizeOrder.push([key, 'DESC']);
      } else if (direction === 'asc') {
        sequelizeOrder.push([key, 'ASC']);
      } else if (direction === 'desc') {
        sequelizeOrder.push([key, 'DESC']);
      } else {
        throw new Error(`Invalid sort direction for field "${key}": ${direction}`);
      }
    }
  }

  return sequelizeOrder;
}
