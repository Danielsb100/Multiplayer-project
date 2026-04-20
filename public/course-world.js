(function () {
    const panel = document.getElementById('course-trail-panel');
    const titleEl = document.getElementById('course-trail-title');
    const summaryEl = document.getElementById('course-trail-summary');
    const progressEl = document.getElementById('course-trail-progress');
    const listEl = document.getElementById('course-trail-list');

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async function waitForBridge(maxAttempts = 80) {
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            if (window.__worldBridge?.getAuthToken?.() && window.__worldBridge?.getAuthApi?.()) {
                return window.__worldBridge;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        return null;
    }

    function normalizePlacement(module, index) {
        if (module.placement) {
            return module.placement;
        }
        return {
            id: `course-${window.__courseWorldContext.courseId}-module-${module.moduleId}`,
            label: module.roomLabel || `Module Room ${index + 1}`,
            position: { x: Math.floor(index / 2) * 18, y: 0, z: index % 2 === 0 ? 0 : 10 },
            rotation: { x: 0, y: 0, z: 0 }
        };
    }

    function renderTrail(runtime, bridge) {
        if (!panel || !titleEl || !summaryEl || !progressEl || !listEl) return;
        panel.classList.remove('hidden');
        titleEl.textContent = runtime.title;
        summaryEl.textContent = runtime.description || 'Follow the rooms in order and complete the required modules to unlock the next ones.';
        progressEl.textContent = `${runtime.progressPercent || 0}% complete • ${runtime.completedCount || 0}/${(runtime.modules || []).length} modules completed`;

        listEl.innerHTML = (runtime.modules || []).map((module, index) => {
            const statusLabel = module.completed ? 'Completed' : (module.unlocked ? 'Available' : 'Locked');
            const statusColor = module.completed ? '#10b981' : (module.unlocked ? '#60a5fa' : '#ef4444');
            return `
                <article data-course-trail-module="${module.moduleId}" style="padding:0.9rem; border-radius:16px; background:rgba(30,41,59,0.75); border:1px solid rgba(255,255,255,0.06); display:flex; flex-direction:column; gap:0.65rem;">
                    <div style="display:flex; justify-content:space-between; gap:0.75rem; align-items:flex-start;">
                        <div>
                            <strong style="display:block; margin-bottom:0.25rem;">${index + 1}. ${escapeHtml(module.title)}</strong>
                            <span style="font-size:0.8rem; color:#94a3b8;">${escapeHtml(module.roomLabel || 'Module room')}</span>
                        </div>
                        <span style="font-size:0.74rem; color:white; background:${statusColor}; border-radius:999px; padding:0.25rem 0.6rem;">${statusLabel}</span>
                    </div>
                    <div style="font-size:0.8rem; color:#cbd5e1;">${module.isRequired ? 'Required' : 'Optional'} • ${escapeHtml(module.moduleStatus || 'DRAFT')}</div>
                    <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                        <button type="button" data-course-trail-action="teleport" data-module-id="${module.moduleId}" class="btn btn-secondary btn-sm" style="padding:0.45rem 0.75rem;">Go to room</button>
                        ${module.unlocked ? `<button type="button" data-course-trail-action="open" data-module-id="${module.moduleId}" class="btn btn-secondary btn-sm" style="padding:0.45rem 0.75rem;">Open module</button>` : ''}
                        ${module.unlocked && !module.completed ? `<button type="button" data-course-trail-action="complete" data-module-id="${module.moduleId}" class="btn btn-secondary btn-sm" style="padding:0.45rem 0.75rem;">Mark complete</button>` : ''}
                    </div>
                </article>
            `;
        }).join('');

        listEl.querySelectorAll('[data-course-trail-action]').forEach((button) => {
            button.addEventListener('click', async () => {
                const moduleId = Number(button.dataset.moduleId);
                const module = runtime.modules.find((entry) => entry.moduleId === moduleId);
                if (!module) return;
                const placement = normalizePlacement(module, runtime.modules.findIndex((entry) => entry.moduleId === moduleId));

                if (button.dataset.courseTrailAction === 'teleport') {
                    bridge.teleportTo(placement.position);
                    return;
                }

                if (button.dataset.courseTrailAction === 'open') {
                    bridge.teleportTo(placement.position);
                    bridge.openModuleSidebar(placement.id, module.moduleId, module.courseModuleId);
                    return;
                }

                if (button.dataset.courseTrailAction === 'complete') {
                    try {
                        button.disabled = true;
                        const response = await fetch(`${bridge.getAuthApi()}/courses/${window.__courseWorldContext.courseId}/modules/${module.moduleId}/complete`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${bridge.getAuthToken()}`
                            },
                            body: JSON.stringify({ source: 'MULTIPLAYER_WORLD' })
                        });
                        const data = await response.json();
                        if (!response.ok) {
                            throw new Error(data.error || 'Failed to complete module.');
                        }
                        await loadRuntime(bridge);
                    } catch (error) {
                        alert(error.message);
                    } finally {
                        button.disabled = false;
                    }
                }
            });
        });
    }

    async function loadRuntime(bridge) {
        const response = await fetch(`${bridge.getAuthApi()}/courses/${window.__courseWorldContext.courseId}/runtime`, {
            headers: { Authorization: `Bearer ${bridge.getAuthToken()}` }
        });
        const runtime = await response.json();
        if (!response.ok) {
            throw new Error(runtime.error || 'Failed to load course runtime.');
        }
        window.__courseWorldContext.runtime = runtime;

        (runtime.modules || []).forEach((module, index) => {
            const placement = normalizePlacement(module, index);
            bridge.createModulePlacement({
                id: placement.id,
                moduleId: module.moduleId,
                courseModuleId: module.courseModuleId,
                moduleTitle: module.title,
                status: module.moduleStatus,
                isLocked: !module.unlocked,
                isCompleted: Boolean(module.completed),
                position: placement.position,
                rotation: placement.rotation || { x: 0, y: 0, z: 0 }
            });
        });

        renderTrail(runtime, bridge);
    }

    async function init() {
        if (!window.__courseWorldContext?.courseId) {
            return;
        }
        const bridge = await waitForBridge();
        if (!bridge) {
            console.warn('Course world bridge not ready.');
            return;
        }

        try {
            await loadRuntime(bridge);
        } catch (error) {
            console.error('Failed to initialize course world:', error);
            if (summaryEl) {
                summaryEl.textContent = error.message;
            }
            if (panel) {
                panel.classList.remove('hidden');
            }
        }
    }

    window.addEventListener('load', init);
})();
