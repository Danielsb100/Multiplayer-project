(function () {
    const panel = document.getElementById('course-trail-panel');
    const titleEl = document.getElementById('course-trail-title');
    const summaryEl = document.getElementById('course-trail-summary');
    const progressEl = document.getElementById('course-trail-progress');
    const listEl = document.getElementById('course-trail-list');
    let latestRuntime = null;
    let lastRenderedActiveModuleId = null;
    let refreshBridge = null;

    const btnLanding = document.getElementById('btn-show-course-landing');
    const modalLanding = document.getElementById('course-landing-modal');
    const closeLandingBtn = document.getElementById('close-course-landing');
    const landingCssEl = document.getElementById('course-landing-custom-css');
    const landingContentEl = document.getElementById('course-landing-content');

    if (closeLandingBtn && modalLanding) {
        closeLandingBtn.addEventListener('click', () => {
            modalLanding.classList.add('hidden');
        });
        modalLanding.addEventListener('click', (e) => {
            if (e.target === modalLanding) {
                modalLanding.classList.add('hidden');
            }
        });
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
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
        const dynamicPosition = window.__worldBridge?.getCourseRoomPlacement?.(
            index,
            module.placement?.position?.y ?? 0
        );
        return {
            id: module.placement?.id || `course-${window.__courseWorldContext.courseId}-module-${module.moduleId}`,
            label: module.roomLabel || module.placement?.label || `Module Room ${index + 1}`,
            position: dynamicPosition || { x: index * 14, y: module.placement?.position?.y ?? 0, z: 0 },
            rotation: module.placement?.rotation || { x: 0, y: 0, z: 0 }
        };
    }

    function renderTrail(runtime, bridge) {
        if (!panel || !titleEl || !summaryEl || !progressEl || !listEl) return;
        latestRuntime = runtime;
        panel.classList.remove('hidden');
        titleEl.textContent = runtime.title;
        summaryEl.textContent = runtime.description || 'Follow the rooms in order and complete the required modules to unlock the next ones.';
        progressEl.textContent = `${runtime.progressPercent || 0}% complete • ${runtime.completedCount || 0}/${(runtime.modules || []).length} modules completed`;

        const activeModuleId = bridge.getActiveCourseRoomModuleId?.() || null;
        lastRenderedActiveModuleId = activeModuleId;
        const actionButtonStyle = 'padding:0.58rem 0.9rem; border:none; border-radius:12px; cursor:pointer; font-weight:700; letter-spacing:0.01em; transition:transform 120ms ease, opacity 120ms ease;';

        listEl.innerHTML = (runtime.modules || []).map((module, index) => {
            const statusLabel = module.completed ? 'Done' : (module.unlocked ? 'Ready' : 'Locked');
            const statusColor = module.completed ? '#10b981' : (module.unlocked ? '#60a5fa' : '#ef4444');
            const stepIcon = module.completed ? '✓' : (module.unlocked ? '•' : '⨯');
            const isCurrentRoom = activeModuleId === module.moduleId;
            const quizRuleText = module.quizRequirementActive
                ? `Quiz gate ${Math.round(module.minimumQuizScore || 0)}%`
                : (module.hasQuiz ? 'Quiz available' : null);
            const quizProgressText = module.hasQuiz
                ? (module.bestQuizScore === null || module.bestQuizScore === undefined
                    ? 'No graded attempt yet.'
                    : `Best score ${module.bestQuizScore.toFixed(1)}%${module.quizRequirementActive ? (module.quizPassed ? ' • Requirement met' : ' • Requirement not met yet') : ''}`)
                : null;
            const showCompleteButton = module.unlocked && !module.completed;
            const completeButtonLabel = module.canMarkComplete ? 'Mark done' : 'Pass quiz first';
            const completeButtonStyle = module.canMarkComplete
                ? `${actionButtonStyle} background:rgba(16,185,129,0.16); color:#d1fae5; border:1px solid rgba(52,211,153,0.25);`
                : `${actionButtonStyle} background:rgba(37,99,235,0.12); color:#dbeafe; border:1px solid rgba(96,165,250,0.22); opacity:0.72; cursor:not-allowed;`;

            return `
                <article data-course-trail-module="${module.moduleId}" style="padding:1rem; border-radius:18px; background:${isCurrentRoom ? 'linear-gradient(135deg, rgba(37,99,235,0.34), rgba(14,165,233,0.22))' : 'rgba(30,41,59,0.78)'}; border:2px solid ${isCurrentRoom ? 'rgba(125,211,252,0.95)' : 'rgba(255,255,255,0.06)'}; display:flex; flex-direction:column; gap:0.7rem; box-shadow:${isCurrentRoom ? '0 0 0 2px rgba(56,189,248,0.18), 0 18px 38px rgba(2,132,199,0.18)' : 'none'}; transform:${isCurrentRoom ? 'translateX(-4px) scale(1.01)' : 'none'}; transition:all 160ms ease;">
                    <div style="display:flex; justify-content:space-between; gap:0.75rem; align-items:flex-start;">
                        <div style="display:flex; gap:0.75rem; align-items:flex-start;">
                            <span style="display:inline-flex; width:30px; height:30px; border-radius:999px; align-items:center; justify-content:center; background:${isCurrentRoom ? 'rgba(186,230,253,0.22)' : (module.completed ? 'rgba(16,185,129,0.18)' : 'rgba(148,163,184,0.16)')}; color:${isCurrentRoom ? '#e0f2fe' : (module.completed ? '#34d399' : '#cbd5e1')}; font-weight:800; flex:0 0 30px;">${stepIcon}</span>
                            <div>
                                <strong style="display:block; margin-bottom:0.25rem; color:${isCurrentRoom ? '#f8fafc' : 'white'};">Room ${index + 1}. ${escapeHtml(module.title)}</strong>
                                <span style="font-size:0.8rem; color:${isCurrentRoom ? '#dbeafe' : '#94a3b8'};">${escapeHtml(module.roomLabel || 'Module room')}</span>
                            </div>
                        </div>
                        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0.4rem;">
                            ${isCurrentRoom ? '<span style="font-size:0.68rem; letter-spacing:0.08em; text-transform:uppercase; color:#e0f2fe; background:rgba(14,165,233,0.22); border:1px solid rgba(125,211,252,0.55); border-radius:999px; padding:0.22rem 0.55rem; font-weight:800;">You are here</span>' : ''}
                            <span style="font-size:0.74rem; color:white; background:${statusColor}; border-radius:999px; padding:0.25rem 0.6rem;">${statusLabel}</span>
                        </div>
                    </div>
                    <div style="font-size:0.8rem; color:${isCurrentRoom ? '#e2e8f0' : '#cbd5e1'}; display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
                        <span>${module.isRequired ? 'Required' : 'Optional'}</span>
                        <span>•</span>
                        <span>${escapeHtml(module.moduleStatus || 'DRAFT')}</span>
                        ${quizRuleText ? `<span>•</span><span>${escapeHtml(quizRuleText)}</span>` : ''}
                        ${isCurrentRoom ? '<span>•</span><strong style="color:#e0f2fe;">Current room</strong>' : ''}
                    </div>
                    ${quizProgressText ? `<div style="font-size:0.78rem; color:${module.quizPassed ? '#86efac' : '#93c5fd'};">${escapeHtml(quizProgressText)}</div>` : ''}
                    <div style="display:flex; gap:0.55rem; flex-wrap:wrap;">
                        ${module.unlocked && !isCurrentRoom ? `<button type="button" data-course-trail-action="teleport" data-module-id="${module.moduleId}" style="${actionButtonStyle} background:linear-gradient(135deg, #2563eb, #38bdf8); color:white; box-shadow:0 10px 24px rgba(37,99,235,0.28);">Go to room</button>` : ''}
                        ${module.unlocked ? `<button type="button" data-course-trail-action="open" data-module-id="${module.moduleId}" style="${actionButtonStyle} background:rgba(255,255,255,0.1); color:#f8fafc; border:1px solid rgba(255,255,255,0.14);">Open module</button>` : ''}
                        ${showCompleteButton ? `<button type="button" data-course-trail-action="complete" data-module-id="${module.moduleId}" style="${completeButtonStyle}" ${module.canMarkComplete ? '' : 'data-completion-blocked="true"'}>${completeButtonLabel}</button>` : ''}
                    </div>
                </article>
            `;
        }).join('');

        if (activeModuleId) {
            const activeCard = listEl.querySelector(`[data-course-trail-module="${activeModuleId}"]`);
            activeCard?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        listEl.querySelectorAll('[data-course-trail-action]').forEach((button) => {
            button.addEventListener('click', async () => {
                const moduleId = Number(button.dataset.moduleId);
                const module = runtime.modules.find((entry) => entry.moduleId === moduleId);
                if (!module) return;
                if (!module.unlocked && button.dataset.courseTrailAction !== 'complete') {
                    alert(module.completionBlockedReason || 'Complete the required previous module before entering this room.');
                    return;
                }

                const placement = normalizePlacement(module, runtime.modules.findIndex((entry) => entry.moduleId === moduleId));

                if (button.dataset.courseTrailAction === 'teleport') {
                    bridge.teleportTo(placement.position);
                    requestAnimationFrame(() => renderTrail(runtime, bridge));
                    return;
                }

                if (button.dataset.courseTrailAction === 'open') {
                    bridge.teleportTo(placement.position);
                    bridge.openModuleSidebar(placement.id, module.moduleId, module.courseModuleId);
                    requestAnimationFrame(() => renderTrail(runtime, bridge));
                    return;
                }

                if (button.dataset.courseTrailAction === 'complete') {
                    if (button.dataset.completionBlocked === 'true') {
                        alert(module.completionBlockedReason || 'Pass the quiz requirement before marking this room as done.');
                        return;
                    }

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

    function startActiveRoomSync(bridge) {
        const tick = () => {
            const activeModuleId = bridge.getActiveCourseRoomModuleId?.() || null;
            if (latestRuntime && !panel?.classList.contains('hidden') && activeModuleId !== lastRenderedActiveModuleId) {
                renderTrail(latestRuntime, bridge);
            }
            window.requestAnimationFrame(tick);
        };
        window.requestAnimationFrame(tick);
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
        window.dispatchEvent(new CustomEvent('course-world:runtime-updated', { detail: runtime }));

        if (runtime.landingPage && runtime.landingPage.compiledHtml && btnLanding) {
            btnLanding.classList.remove('hidden');
            btnLanding.onclick = () => {
                if (runtime.landingPage.compiledCss && landingCssEl) {
                    landingCssEl.innerHTML = runtime.landingPage.compiledCss;
                } else if (bridge.getAuthApi) {
                    let link = document.getElementById('dynamic-landing-css');
                    if (!link) {
                        const cssUrl = bridge.getAuthApi() + '/css/modular-style.css';
                        link = document.createElement('link');
                        link.id = 'dynamic-landing-css';
                        link.rel = 'stylesheet';
                        link.href = cssUrl;
                        document.head.appendChild(link);
                    }
                }
                if (landingContentEl) {
                    landingContentEl.innerHTML = `<div id="landing-page-builder-section" class="view-mode" style="min-height: 100%;">${runtime.landingPage.compiledHtml}</div>`;
                }
                modalLanding.classList.remove('hidden');
            };
        }

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

        bridge.renderCourseRoomShells?.(runtime);
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

        refreshBridge = bridge;
        window.addEventListener('course-world:refresh-runtime', () => {
            if (!refreshBridge) return;
            loadRuntime(refreshBridge).catch((error) => console.error('Failed to refresh course runtime:', error));
        });

        try {
            await loadRuntime(bridge);
            startActiveRoomSync(bridge);
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
