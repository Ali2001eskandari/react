/**
 * Copyright 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule ReactFiberRoot
 * @flow
 */

'use strict';

import type {Fiber} from 'ReactFiber';
import type {UpdateQueue} from 'ReactFiberUpdateQueue';
import type {ExpirationTime} from 'ReactFiberExpirationTime';

const {createHostRootFiber} = require('ReactFiber');
const {getUpdateQueueExpirationTime} = require('ReactFiberUpdateQueue');

const {Done} = require('ReactFiberExpirationTime');

export type FiberRoot = {
  // Any additional information from the host associated with this root.
  containerInfo: any,
  // The currently active root fiber. This is the mutable root of the tree.
  current: Fiber,
  // Determines if this root has already been added to the schedule for work.
  isScheduled: boolean,
  // The time at which this root completed.
  completedAt: ExpirationTime,
  // A queue that represents times at which this root is blocked
  // from committing.
  blockers: UpdateQueue<null> | null,
  // A queue of callbacks that fire once their corresponding expiration time
  // has completed. Only fired once.
  completionCallbacks: UpdateQueue<null> | null,
  // When set, indicates that all work in this tree with this time or earlier
  // should be flushed by the end of the batch, as if it has task priority.
  forceExpire: null | ExpirationTime,
  // The work schedule is a linked list.
  nextScheduledRoot: FiberRoot | null,
  // Top context object, used by renderSubtreeIntoContainer
  context: Object | null,
  pendingContext: Object | null,
};

exports.isRootBlocked = function(
  root: FiberRoot,
  expirationTime: ExpirationTime,
) {
  const blockers = root.blockers;
  if (blockers === null) {
    return false;
  }
  const blockedAt = getUpdateQueueExpirationTime(blockers);
  return blockedAt !== Done && blockedAt <= expirationTime;
};

exports.createFiberRoot = function(containerInfo: any): FiberRoot {
  // Cyclic construction. This cheats the type system right now because
  // stateNode is any.
  const uninitializedFiber = createHostRootFiber();
  const root = {
    current: uninitializedFiber,
    containerInfo: containerInfo,
    isScheduled: false,
    completedAt: Done,
    blockers: null,
    completionCallbacks: null,
    forceExpire: null,
    nextScheduledRoot: null,
    context: null,
    pendingContext: null,
  };
  uninitializedFiber.stateNode = root;
  return root;
};
