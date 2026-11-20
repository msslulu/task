<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

type Task = {
	id: number;
	title: string;
	completed: boolean;
	createdAt: string;
	updatedAt: string;
};

type TaskResponse = {
	data: Task[];
};

type SingleTaskResponse = {
	data: Task;
};

type User = {
	id: number;
	email: string;
};

type Filter = 'all' | 'active' | 'completed';

const tasks = ref<Task[]>([]);
const newTitle = ref('');
const activeFilter = ref<Filter>('all');
const isLoading = ref(true);
const isSubmitting = ref(false);
const busyTaskId = ref<number | null>(null);
const editingTaskId = ref<number | null>(null);
const editingTitle = ref('');
const errorMessage = ref('');
const currentUser = ref<User | null>(null);
const authMode = ref<'login' | 'register'>('login');
const authEmail = ref('');
const authPassword = ref('');
const authLoading = ref(false);

const completedCount = computed(() => tasks.value.filter((task) => task.completed).length);
const activeCount = computed(() => tasks.value.length - completedCount.value);
const completionRate = computed(() =>
	tasks.value.length ? Math.round((completedCount.value / tasks.value.length) * 100) : 0,
);

const filteredTasks = computed(() => {
	if (activeFilter.value === 'active') {
		return tasks.value.filter((task) => !task.completed);
	}

	if (activeFilter.value === 'completed') {
		return tasks.value.filter((task) => task.completed);
	}

	return tasks.value;
});

const filterLabel = computed(() => {
	if (activeFilter.value === 'active') return '待完成任务';
	if (activeFilter.value === 'completed') return '已完成任务';
	return '全部任务';
});

async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
	const response = await fetch(input, { ...init, credentials: 'same-origin' });
	const payload = (await response.json().catch(() => null)) as { error?: string } | null;

	if (!response.ok) {
		throw new Error(payload?.error ?? '请求失败，请稍后重试。');
	}

	return payload as T;
}

async function loadSession() {
	try {
		const response = await request<{ data: User }>('/api/auth/me');
		currentUser.value = response.data;
		await loadTasks();
	} catch {
		currentUser.value = null;
		isLoading.value = false;
	}
}

async function submitAuth() {
	const email = authEmail.value.trim();
	if (!email || !authPassword.value || authLoading.value) return;

	authLoading.value = true;
	errorMessage.value = '';
	try {
		const endpoint = authMode.value === 'login' ? '/api/auth/login' : '/api/auth/register';
		const response = await request<{ data: User }>(endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, password: authPassword.value }),
		});
		currentUser.value = response.data;
		authPassword.value = '';
		await loadTasks();
	} catch (error) {
		errorMessage.value = error instanceof Error ? error.message : '认证失败，请稍后重试。';
	} finally {
		authLoading.value = false;
	}
}

async function logout() {
	await request('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
	currentUser.value = null;
	tasks.value = [];
	authEmail.value = '';
	authPassword.value = '';
	authMode.value = 'login';
}

async function loadTasks() {
	isLoading.value = true;
	errorMessage.value = '';

	try {
		const response = await request<TaskResponse>('/api/tasks');
		tasks.value = response.data;
	} catch (error) {
		errorMessage.value = error instanceof Error ? error.message : '无法加载任务。';
	} finally {
		isLoading.value = false;
	}
}

async function addTask() {
	const title = newTitle.value.trim();
	if (!title || isSubmitting.value) return;

	isSubmitting.value = true;
	errorMessage.value = '';

	try {
		const response = await request<SingleTaskResponse>('/api/tasks', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title }),
		});
		tasks.value = [response.data, ...tasks.value];
		newTitle.value = '';
	} catch (error) {
		errorMessage.value = error instanceof Error ? error.message : '无法创建任务。';
	} finally {
		isSubmitting.value = false;
	}
}

async function toggleTask(task: Task) {
	if (busyTaskId.value !== null || editingTaskId.value !== null) return;

	busyTaskId.value = task.id;
	errorMessage.value = '';

	try {
		const response = await request<SingleTaskResponse>(`/api/tasks/${task.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ completed: !task.completed }),
		});
		const index = tasks.value.findIndex((item) => item.id === task.id);
		if (index !== -1) tasks.value[index] = response.data;
	} catch (error) {
		errorMessage.value = error instanceof Error ? error.message : '无法更新任务。';
	} finally {
		busyTaskId.value = null;
	}
}

function startEditing(task: Task) {
	if (busyTaskId.value !== null) return;

	editingTaskId.value = task.id;
	editingTitle.value = task.title;
	errorMessage.value = '';
}

function cancelEditing() {
	editingTaskId.value = null;
	editingTitle.value = '';
}

async function saveTask(task: Task) {
	const title = editingTitle.value.trim();
	if (!title || busyTaskId.value !== null) return;

	busyTaskId.value = task.id;
	errorMessage.value = '';

	try {
		const response = await request<SingleTaskResponse>(`/api/tasks/${task.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title }),
		});
		const index = tasks.value.findIndex((item) => item.id === task.id);
		if (index !== -1) tasks.value[index] = response.data;
		cancelEditing();
	} catch (error) {
		errorMessage.value = error instanceof Error ? error.message : '无法保存任务。';
	} finally {
		busyTaskId.value = null;
	}
}

async function deleteTask(task: Task) {
	if (busyTaskId.value !== null) return;
	if (!window.confirm(`确定删除任务“${task.title}”吗？`)) return;

	busyTaskId.value = task.id;
	errorMessage.value = '';

	try {
		await request<{ data: { id: number } }>(`/api/tasks/${task.id}`, {
			method: 'DELETE',
		});
		tasks.value = tasks.value.filter((item) => item.id !== task.id);
		if (editingTaskId.value === task.id) cancelEditing();
	} catch (error) {
		errorMessage.value = error instanceof Error ? error.message : '无法删除任务。';
	} finally {
		busyTaskId.value = null;
	}
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat('zh-CN', {
		month: 'short',
		day: 'numeric',
	}).format(new Date(value));
}

onMounted(loadSession);
</script>

<template>
	<div class="app-shell">
		<div class="ambient ambient-one"></div>
		<div class="ambient ambient-two"></div>

		<main class="dashboard">
			<header class="topbar">
				<a class="brand" href="/" aria-label="Taskflow 首页">
					<span class="brand-mark"><span></span><span></span><span></span></span>
					<span>taskflow</span>
				</a>
				<div v-if="currentUser" class="account-area">
					<span class="user-email">{{ currentUser.email }}</span>
					<button class="logout-button" type="button" @click="logout">退出登录</button>
				</div>
				<div v-else class="connection-status"><span class="status-dot"></span> 安全登录</div>
			</header>

			<section v-if="!currentUser" class="auth-card">
				<div class="auth-copy">
					<p class="eyebrow">Taskflow Account <span>✦</span></p>
					<h1>{{ authMode === 'login' ? '欢迎回来，继续完成重要的事。' : '创建账户，开始你的工作节奏。' }}</h1>
					<p class="hero-copy">登录后，你的任务会安全地保存在自己的账户下。</p>
				</div>
				<form class="auth-form" @submit.prevent="submitAuth">
					<label>邮箱<input v-model="authEmail" type="email" autocomplete="email" placeholder="you@example.com" required /></label>
					<label>密码<input v-model="authPassword" type="password" :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'" placeholder="至少 8 个字符" minlength="8" required /></label>
					<button class="auth-submit" type="submit" :disabled="authLoading || !authEmail.trim() || authPassword.length < 8">
						<span v-if="authLoading" class="spinner"></span>
						<span v-else>{{ authMode === 'login' ? '登录' : '注册并登录' }}</span>
					</button>
					<button class="auth-switch" type="button" @click="authMode = authMode === 'login' ? 'register' : 'login'; errorMessage = ''">
						{{ authMode === 'login' ? '还没有账户？立即注册' : '已有账户？返回登录' }}
					</button>
				</form>
			</section>

			<div v-if="!currentUser && errorMessage" class="error-message auth-error" role="alert"><span>!</span>{{ errorMessage }}</div>

			<template v-if="currentUser">
			<section class="hero">
				<div>
					<p class="eyebrow">今日工作台 <span>✦</span></p>
					<h1>把重要的事，<em>一件件完成。</em></h1>
					<p class="hero-copy">清晰的计划带来专注的行动。记录任务，保持节奏，享受每一次完成。</p>
				</div>
				<div class="progress-ring" :style="{ '--progress': `${completionRate * 3.6}deg` }">
					<div class="progress-ring-inner">
						<strong>{{ completionRate }}<small>%</small></strong>
						<span>完成率</span>
					</div>
				</div>
			</section>

			<section class="stats-grid" aria-label="任务概览">
				<article class="stat-card stat-primary">
					<span class="stat-icon">◌</span>
					<div><strong>{{ tasks.length }}</strong><span>全部任务</span></div>
				</article>
				<article class="stat-card">
					<span class="stat-icon icon-orange">◷</span>
					<div><strong>{{ activeCount }}</strong><span>待完成</span></div>
				</article>
				<article class="stat-card">
					<span class="stat-icon icon-green">✓</span>
					<div><strong>{{ completedCount }}</strong><span>已完成</span></div>
				</article>
			</section>

			<section class="task-panel">
				<div class="panel-heading">
					<div>
						<p class="section-kicker">我的清单</p>
						<h2>{{ filterLabel }}</h2>
					</div>
					<div class="filters" role="tablist" aria-label="任务筛选">
						<button :class="{ active: activeFilter === 'all' }" @click="activeFilter = 'all'">全部</button>
						<button :class="{ active: activeFilter === 'active' }" @click="activeFilter = 'active'">进行中</button>
						<button :class="{ active: activeFilter === 'completed' }" @click="activeFilter = 'completed'">已完成</button>
					</div>
				</div>

				<form class="add-task" @submit.prevent="addTask">
					<span class="plus-icon">＋</span>
					<input v-model="newTitle" type="text" maxlength="120" placeholder="添加一个新任务..." aria-label="任务标题" />
					<button type="submit" :disabled="isSubmitting || !newTitle.trim()">
						<span v-if="isSubmitting" class="spinner"></span>
						<span v-else>添加任务</span>
					</button>
				</form>

				<div v-if="errorMessage" class="error-message" role="alert">
					<span>!</span>{{ errorMessage }}
					<button @click="loadTasks">重试</button>
				</div>

				<div v-if="isLoading" class="state-card">
					<span class="large-spinner"></span>
					<p>正在加载你的任务...</p>
				</div>
				<div v-else-if="filteredTasks.length === 0" class="state-card empty-state">
					<div class="empty-illustration">✦</div>
					<h3>{{ tasks.length ? '这个筛选下还没有任务' : '从第一个任务开始吧' }}</h3>
					<p>{{ tasks.length ? '换个筛选条件，或添加一件新任务。' : '写下你想完成的第一件事，让今天有个好开始。' }}</p>
				</div>
				<ul v-else class="task-list">
					<li v-for="task in filteredTasks" :key="task.id" class="task-item" :class="{ completed: task.completed }">
						<button
							class="check-button"
							:class="{ checked: task.completed }"
							:disabled="busyTaskId === task.id || editingTaskId === task.id"
							:aria-label="task.completed ? '标记为未完成' : '标记为已完成'"
							@click="toggleTask(task)"
						>
							<span v-if="task.completed">✓</span>
						</button>
						<div v-if="editingTaskId === task.id" class="task-edit-form">
							<input
								v-model="editingTitle"
								class="task-edit-input"
								maxlength="120"
								autocomplete="off"
								aria-label="编辑任务标题"
								@keydown.enter.prevent="saveTask(task)"
								@keydown.esc="cancelEditing"
							/>
							<div class="edit-actions">
								<button class="save-button" type="button" :disabled="busyTaskId === task.id || !editingTitle.trim()" @click="saveTask(task)">保存</button>
								<button class="cancel-button" type="button" :disabled="busyTaskId === task.id" @click="cancelEditing">取消</button>
							</div>
						</div>
						<div v-else class="task-content">
							<strong>{{ task.title }}</strong>
							<span>创建于 {{ formatDate(task.createdAt) }}</span>
						</div>
						<span v-if="editingTaskId !== task.id" class="task-tag" :class="task.completed ? 'tag-done' : 'tag-todo'">{{ task.completed ? '已完成' : '进行中' }}</span>
						<div v-if="editingTaskId !== task.id" class="task-actions">
							<button class="task-action edit-action" type="button" :disabled="busyTaskId === task.id" aria-label="编辑任务" @click="startEditing(task)">✎</button>
							<button class="task-action delete-action" type="button" :disabled="busyTaskId === task.id" aria-label="删除任务" @click="deleteTask(task)">×</button>
						</div>
					</li>
				</ul>
			</section>
			</template>

			<footer class="footer-note">专注当下，持续前进 <span>·</span> Powered by Hono + Vue</footer>
		</main>
	</div>
</template>
