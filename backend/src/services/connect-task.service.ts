import type { DiscussTaskDto } from '@healthy-tasks/shared';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { computeTaskAccess, type Actor } from './access-control.service.js';
import {
  addToConnectGroup,
  connectAvailable,
  connectChatUrl,
  ConnectError,
  makeConnectGroup,
  sendConnectMessage,
} from './connect.service.js';

/**
 * "Discuss in Connect" on a task (Nov 2026 plan, K5): makes the task's group
 * chat in Connect the first time — the assignee, the creator, the assignee's
 * supervisor and whoever pressed it — starting with a link back to the task;
 * after that it reopens the same chat (bringing the presser in). The talk lives
 * in Connect, not on the task.
 */
export async function discussTask(actor: Actor, taskId: number): Promise<DiscussTaskDto> {
  if (!connectAvailable()) throw new HttpError(503, 'Connect isn’t linked to HL Central yet');
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      name: true,
      isPrivate: true,
      assigneeId: true,
      connectConversationId: true,
      creator: { select: { email: true } },
      assignee: { select: { email: true, supervisor: { select: { email: true } } } },
    },
  });
  if (!task || !(await computeTaskAccess(actor, task))) throw HttpError.notFound('Task not found');
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: { email: true },
  });
  const members = [
    ...new Set(
      [
        me.email,
        task.assignee?.email,
        task.creator?.email,
        task.assignee?.supervisor?.email,
      ].filter((x): x is string => !!x),
    ),
  ];
  const link = `${env.frontendUrl}/tasks/${task.id}`;
  try {
    if (task.connectConversationId) {
      await addToConnectGroup(task.connectConversationId, [me.email]).catch(() => {
        /* already in it */
      });
      return {
        url: connectChatUrl(task.connectConversationId),
        conversationId: task.connectConversationId,
        created: false,
        skipped: [],
      };
    }
    const group = await makeConnectGroup({
      name: `#${task.id} ${task.name}`,
      topic: `HL Central task: ${link}`,
      members,
    });
    // Two presses at once: keep the first chat.
    const kept = await prisma.task.updateMany({
      where: { id: task.id, connectConversationId: null },
      data: { connectConversationId: group.id },
    });
    if (kept.count === 0) {
      const now = await prisma.task.findUniqueOrThrow({
        where: { id: task.id },
        select: { connectConversationId: true },
      });
      return {
        url: connectChatUrl(now.connectConversationId!),
        conversationId: now.connectConversationId!,
        created: false,
        skipped: [],
      };
    }
    await sendConnectMessage({
      conversationId: group.id,
      text: `**HL Central:** a chat about the task “${task.name}”\n${link}`,
      idempotencyKey: `discuss:${task.id}`,
    }).catch((err) => console.error('Connect first message failed', err));
    return {
      url: connectChatUrl(group.id),
      conversationId: group.id,
      created: true,
      skipped: group.skipped,
    };
  } catch (err) {
    if (err instanceof ConnectError) {
      throw new HttpError(502, err.status === 0 ? err.message : `Connect said: ${err.message}`);
    }
    throw err;
  }
}
