/** Typed host boundary for R0P91 Tasks.
 *
 * The renderer receives bounded projections and explicit actions only.  A
 * bootstrapper installs an adapter backed by the core TaskService; this file
 * never creates a second task store or scheduler.
 */
import {
  TaskService,
  TaskError,
  type CreateTaskInput,
  type CreateTaskListInput,
  type Task,
  type TaskId,
  type TaskListId,
  type TaskQuery,
  type TaskView,
  type UpdateTaskInput,
  type PersonalTaskList,
} from '@keystone/core';

export interface DesktopTaskList {
  readonly id: TaskListId;
  readonly name: string;
  readonly scope: PersonalTaskList['scope'];
  readonly pinned: boolean;
  readonly builtIn?: PersonalTaskList['builtIn'];
  readonly memberCount: number;
  readonly epoch: number;
  readonly tombstone: boolean;
}

export interface DesktopTask {
  readonly id: TaskId;
  readonly listId: TaskListId;
  readonly title: string;
  readonly note?: string;
  readonly status: Task['status'];
  readonly priority: Task['priority'];
  readonly tags: readonly string[];
  readonly orderKey: string;
  readonly start?: Task['start'];
  readonly due?: Task['due'];
  readonly reminders: Task['reminders'];
  readonly recurrence?: Task['recurrence'];
  readonly parentId?: TaskId;
  readonly assignee?: string;
  readonly updatedAt: string;
}

export interface DesktopTaskPage {
  readonly items: readonly DesktopTask[];
  readonly total: number;
  readonly nextCursor?: string;
}

export interface DesktopTaskRuntime {
  lists(options?: { readonly includeTrash?: boolean; readonly scope?: PersonalTaskList['scope'] }): Promise<readonly DesktopTaskList[]>;
  tasks(options?: TaskQuery): Promise<DesktopTaskPage>;
  search(query: string, options?: Omit<TaskQuery, 'query'>): Promise<DesktopTaskPage>;
  task?(taskId: string): Promise<DesktopTask | undefined>;
  create(input: CreateTaskInput): Promise<DesktopTask>;
  quickCapture(title: string, options?: { readonly listId?: TaskListId | string; readonly locale?: 'en' | 'ru'; readonly timezone?: string }): Promise<DesktopTask>;
  previewQuickCapture(title: string, options?: { readonly locale?: 'en' | 'ru'; readonly timezone?: string }): ReturnType<TaskService['previewQuickCapture']>;
  update(taskId: TaskId | string, patch: UpdateTaskInput): Promise<DesktopTask>;
  complete(taskId: TaskId | string): Promise<DesktopTask>;
  reopen(taskId: TaskId | string): Promise<DesktopTask>;
  trash(taskId: TaskId | string): Promise<DesktopTask>;
  restore(taskId: TaskId | string): Promise<DesktopTask>;
  reorder(taskId: TaskId | string, input: { readonly beforeTaskId?: TaskId | string; readonly afterTaskId?: TaskId | string }): Promise<DesktopTask>;
  addSubtask(parentTaskId: TaskId | string, input: Omit<CreateTaskInput, 'parentId' | 'listId'> & { readonly listId?: TaskListId | string }): Promise<DesktopTask>;
  createList?(input: CreateTaskListInput): Promise<DesktopTaskList>;
  deleteList?(listId: TaskListId | string): Promise<DesktopTaskList>;
  subscribe?(listener: () => void): () => void;
}

let current: DesktopTaskRuntime | undefined;
const listeners = new Set<() => void>();

export function installDesktopTasksRuntime(runtime: DesktopTaskRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getDesktopTasksRuntime(): DesktopTaskRuntime | undefined { return current; }
export function subscribeDesktopTasksRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }

export function createDesktopTasksRuntime(service: TaskService): DesktopTaskRuntime {
  const listProjection = (list: PersonalTaskList): DesktopTaskList => ({ id: list.id, name: list.name, scope: list.scope, pinned: list.pinned, ...(list.builtIn ? { builtIn: list.builtIn } : {}), memberCount: list.members.filter(member => !member.removedAt).length, epoch: list.epoch, tombstone: list.tombstone });
  const taskProjection = (task: Task): DesktopTask => ({ id: task.id, listId: task.listId, title: task.title, ...(task.note ? { note: task.note } : {}), status: task.status, priority: task.priority, tags: task.tags, orderKey: task.orderKey, ...(task.start ? { start: task.start } : {}), ...(task.due ? { due: task.due } : {}), reminders: task.reminders, ...(task.recurrence ? { recurrence: task.recurrence } : {}), ...(task.parentId ? { parentId: task.parentId } : {}), ...(task.assignee ? { assignee: task.assignee } : {}), updatedAt: task.updatedAt });
  const pageProjection = async (promise: ReturnType<TaskService['listTasks']>): Promise<DesktopTaskPage> => { const page = await promise; return { ...page, items: page.items.map(taskProjection) }; };
  return {
    lists: async options => (await service.listLists(options)).map(listProjection),
    tasks: options => pageProjection(service.listTasks(options)),
    search: (query, options) => pageProjection(service.searchTasks(query, options)),
    task: async taskId => {
      await service.ready();
      try { return taskProjection(service.getTask(taskId)); }
      catch (reason) {
        if (reason instanceof TaskError && reason.code === 'NOT_FOUND') return undefined;
        throw reason;
      }
    },
    create: async input => taskProjection(await service.createTask(input)),
    quickCapture: async (title, options) => taskProjection(await service.quickCapture(title, options)),
    previewQuickCapture: (title, options) => service.previewQuickCapture(title, options),
    update: async (taskId, patch) => taskProjection(await service.updateTask(taskId, patch)),
    complete: async taskId => taskProjection(await service.completeTask(taskId)),
    reopen: async taskId => taskProjection(await service.reopenTask(taskId)),
    trash: async taskId => taskProjection(await service.deleteTask(taskId)),
    restore: async taskId => taskProjection(await service.restoreTask(taskId)),
    reorder: async (taskId, input) => taskProjection(await service.reorderTask(taskId, input)),
    addSubtask: async (parentTaskId, input) => taskProjection(await service.addSubtask(parentTaskId, input)),
    createList: async input => listProjection(await service.createList(input)),
    deleteList: async listId => listProjection(await service.deleteList(listId)),
    subscribe: listener => service.subscribe(() => listener()),
  };
}
