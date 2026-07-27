import { Link, useNavigate } from 'react-router-dom';
import type { CreateTaskRequest } from '@healthy-tasks/shared';
import { api } from '../api/client';
import { TaskForm } from '../components/TaskForm';

export function TaskCreatePage() {
  const navigate = useNavigate();

  return (
    <div className="container">
      <p style={{ marginTop: 0 }}>
        <Link to="/tasks">← Back to tasks</Link>
      </p>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>New task</h2>
        <TaskForm
          submitLabel="Create task"
          onSubmit={async (payload) => {
            const created = await api.createTask(payload satisfies CreateTaskRequest);
            navigate(`/tasks/${created.id}`);
          }}
        />
      </div>
    </div>
  );
}
