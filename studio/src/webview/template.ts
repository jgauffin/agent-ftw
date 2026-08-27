/**
 * The panel's markup.
 *
 * Two panes. The drawing on the left is the navigator: it is the map, and
 * clicking a node is how you move. The inspector on the right shows exactly one
 * thing at a time, chosen by its tab bar, because a prompt, a schema and a tool
 * list each want the whole pane to be workable and a VS Code panel is often
 * half a screen.
 *
 * Class names describe what a thing is, not what it looks like; the styling
 * lives entirely in the stylesheet.
 *
 * Two things about the engine shape everything here.
 *
 * Every dynamic attribute is a single `{{expression}}` and nothing else. The
 * engine replaces an attribute that contains an expression with that
 * expression's value, so literal text beside it, and any second expression, is
 * dropped. Composed class strings, and every coordinate in the drawing, are
 * therefore built in the view model.
 *
 * And `value` binds the DOM property rather than the attribute. The control
 * shows the right thing; a test that reads the attribute back sees the
 * unrendered `{{...}}` and has to read the property instead.
 */
export const TEMPLATE = `
<div class="studio">

  <header class="run-controls">
    <label class="agent-picker" if="manyAgents">
      <span>Agent</span>
      <select r-change="selectAgent(event)">
        <option loop="a in agents" value="{{a.exportName}}" selected="{{a.selected}}">{{a.label}}</option>
      </select>
    </label>
    <textarea class="run-input" rows="1" if="textMode" placeholder="{{inputPlaceholder}}"></textarea>
    <button class="input-mode" r-click="useFields()" if="canUseFields">Fields</button>
    <button class="start" r-click="run()" disabled="{{running}}">Run</button>
    <button class="stop" r-click="cancel()" if="running">Cancel</button>
    <span class="{{statusClass}}">{{status}}</span>
  </header>

  <section class="run-fields" if="fieldsMode">
    <p class="hint">This agent is called with a declared input where it is used as a sub-agent. Leave a field blank to omit it.</p>
    <ol>
      <li loop="f in inputFields">
        <label for="{{f.inputId}}">{{f.label}}</label>
        <input id="{{f.inputId}}" class="run-field" type="{{f.inputType}}" data-field="{{f.name}}" placeholder="{{f.placeholder}}">
        <span class="field-note">{{f.note}}</span>
      </li>
    </ol>
    <button class="input-mode" r-click="useText()">Use plain text instead</button>
  </section>

  <p class="failure" if="hasError">{{error}}</p>

  <section class="prompt" if="hasPrompt">

    <div if="isAsk">
      <h2>{{ask.agent}} / {{ask.phase}} is asking</h2>
      <p class="question">{{ask.prompt}}</p>
      <ul class="options">
        <li loop="o in ask.options"><button r-click="answerOption(o)">{{o}}</button></li>
      </ul>
      <textarea class="prompt-text" rows="2" placeholder="Or answer in your own words"></textarea>
      <button r-click="answerOther()">Send</button>
    </div>

    <div if="isReview">
      <h2>Review {{review.agent}} / {{review.phase}}</h2>
      <pre class="deliverable">{{review.json}}</pre>
      <textarea class="prompt-text" rows="3" placeholder="What should change? Sends the phase back to revise."></textarea>
      <button r-click="revise()">Request revision</button>
      <button class="approve" r-click="approve()">Approve</button>
    </div>

    <div if="isBudget">
      <h2>{{budget.agent}} / {{budget.phase}} ran out of turns</h2>
      <p class="warning" if="budget.runWide">
        This is the run-wide budget, shared by the whole tree. Granting here gives turns to everything, not just this phase.
      </p>
      <dl class="budget-facts">
        <dt>Budget</dt><dd>{{budget.originalBudget}}</dd>
        <dt>Used</dt><dd>{{budget.turnsUsed}}</dd>
        <dt>Extensions so far</dt><dd>{{budget.extensionsGranted}}</dd>
        <dt>Last said</dt><dd>{{budget.lastText}}</dd>
        <dt>Recent calls</dt><dd>{{budget.recent}}</dd>
      </dl>
      <input class="budget-amount" type="number" min="1" value="{{budget.suggestedExtension}}">
      <button r-click="grant()">Grant</button>
      <button r-click="deny()">Deny</button>
    </div>

  </section>

  <div class="workspace">

    <nav class="map">
      <p class="hint" if="needsAgentChoice">
        This file exports more than one tree. Pick which one to show with the <strong>Agent</strong> picker above.
      </p>
      <svg class="graph" width="{{graph.width}}" height="{{graph.height}}" viewBox="{{graph.viewBox}}">
        <path loop="e in graph.edges" class="{{e.edgeClass}}" d="{{e.d}}" fill="none"></path>
        <g loop="a in graph.agents" class="{{a.boxClass}}" transform="{{a.transform}}" r-click="select(a)">
          <rect class="box" width="{{a.width}}" height="{{a.height}}" rx="4"></rect>
          <text class="node-name" x="10" y="18">{{a.label}}</text>
          <text class="node-role" x="{{a.rightX}}" y="18" text-anchor="end">{{a.role}}</text>
          <text class="node-badge" x="{{a.rightX}}" y="18" text-anchor="end" if="a.hasBadge">{{a.badge}}</text>
        </g>
        <g loop="p in graph.phases" class="{{p.boxClass}}" transform="{{p.transform}}" r-click="select(p)">
          <rect class="box" width="{{p.width}}" height="{{p.height}}" rx="3"></rect>
          <text class="node-name" x="8" y="15">{{p.label}}</text>
          <text class="node-note" x="{{p.rightX}}" y="15" text-anchor="end">{{p.note}}</text>
        </g>
      </svg>
    </nav>

    <section class="inspector">

      <header class="inspector-head" if="hasTabs">
        <span class="inspector-title">{{inspectorTitle}}</span>
        <span class="inspector-subtitle">{{inspectorSubtitle}}</span>
        <button class="reveal" r-click="reveal()">Open source</button>
      </header>

      <nav class="tabs">
        <button loop="t in tabs" class="{{t.tabClass}}" r-click="setTab(t)">
          {{t.label}}<span class="tab-badge" if="t.hasBadge">{{t.badge}}</span>
        </button>
      </nav>

      <div class="tab-body">

        <p class="hint" unless="hasTabs">Open a file that exports an agent, then pick a node in the map.</p>

        <div class="pane" if="showPrompt">
          <label class="{{phase.promptControl.rowClass}}" for="{{phase.promptControl.inputId}}">
            What this phase is told to do
          </label>
          <textarea id="{{phase.promptControl.inputId}}" class="field grow card-prompt"
            data-key="{{phase.promptControl.key}}" disabled="{{phase.promptControl.locked}}"
            r-change="stageField(phase.promptControl, event)">{{phase.promptControl.value}}</textarea>
          <span class="lock-reason" if="phase.promptControl.locked">{{phase.promptControl.reason}}</span>

          <label class="{{phase.budgetControl.rowClass}}" for="{{phase.budgetControl.inputId}}">Turn budget</label>
          <input id="{{phase.budgetControl.inputId}}" class="field narrow card-budget" type="number" min="1"
            value="{{phase.budgetControl.value}}" data-key="{{phase.budgetControl.key}}"
            disabled="{{phase.budgetControl.locked}}" r-change="stageField(phase.budgetControl, event)">
          <span class="lock-reason" if="phase.budgetControl.locked">{{phase.budgetControl.reason}}</span>

          <p class="note" if="phase.hasBadges">{{phase.badges}}</p>
        </div>

        <div class="pane" if="showDeliverable">
          <p class="hint">The shape this phase must produce. A phase does not end until the model emits a payload that validates against it.</p>
          <div loop="s in schemas" class="schema-entry">
            <h4>{{s.title}}</h4>
            <pre class="schema" unless="s.editable">{{s.json}}</pre>
            <textarea class="field grow schema-edit" if="s.editable"
              data-key="{{s.control.key}}" r-change="stageField(s.control, event)">{{s.json}}</textarea>
          </div>
        </div>

        <div class="pane" if="showChecklist">
          <p class="hint">An LLM-as-judge gate. Failing checks send the phase back once, with the failures as feedback.</p>
          <label class="{{phase.checklistControl.rowClass}}" for="{{phase.checklistControl.inputId}}">
            How the deliverable is graded
          </label>
          <textarea id="{{phase.checklistControl.inputId}}" class="field grow"
            data-key="{{phase.checklistControl.key}}" disabled="{{phase.checklistControl.locked}}"
            r-change="stageField(phase.checklistControl, event)">{{phase.checklistControl.value}}</textarea>
          <span class="lock-reason" if="phase.checklistControl.locked">{{phase.checklistControl.reason}}</span>
        </div>

        <div class="pane" if="showTools">
          <ul class="tools" if="hasPhase">
            <li loop="t in phase.tools" class="{{t.kind}}">
              <span class="tool-name">{{t.name}}</span>
              <span class="{{t.noteClass}}">{{t.description}}</span>
            </li>
          </ul>

          <ul class="tools" unless="hasPhase">
            <li loop="t in definition.available" class="{{t.kind}}">
              <span class="tool-name">{{t.name}}</span>
              <span class="{{t.noteClass}}">{{t.description}}</span>
            </li>
          </ul>

          <div unless="hasPhase">
            <h4>May hand down</h4>
            <p class="hint" unless="definition.hasDelegable">Nothing. A sub-agent may only declare tools listed here.</p>
            <ul class="tools">
              <li loop="t in definition.delegableTools" class="{{t.kind}}">
                <span class="tool-name">{{t.name}}</span>
              </li>
            </ul>

            <h4 if="definition.hasAssignable">Assign a tool</h4>
            <div class="assign" if="definition.hasAssignable">
              <select class="assign-tool">
                <option loop="a in definition.assignable" value="{{a.identifier}}" data-file="{{a.file}}">{{a.label}}</option>
              </select>
              <button r-click="assign('tools')">Add to tools</button>
              <button r-click="assign('delegable')">Hand down</button>
            </div>
            <p class="unwired" if="definition.hasUnwired">Declared but unreachable: {{definition.unwired}}</p>
          </div>
        </div>

        <div class="pane" if="showSubAgents">
          <ul class="sub-agent-cards">
            <li loop="s in definition.subAgents" class="{{s.cardClass}}">
              <header r-click="select(s)">
                <span class="card-name">{{s.name}}</span>
                <span class="card-role">{{s.role}}</span>
              </header>
              <p class="card-description">{{s.description}}</p>
              <dl>
                <dt>Phases</dt><dd>{{s.phases}}</dd>
                <dt>Declared on</dt><dd>{{s.declaredBy}}</dd>
                <dt if="s.hasDelegable">Granted</dt>
                <dd if="s.hasDelegable">{{s.delegable}}</dd>
                <dt>Acceptance</dt><dd>{{s.acceptance}}</dd>
                <dt>Max rejects</dt>
                <dd class="{{s.rejectsControl.rowClass}}">
                  <input class="field narrow" type="number" min="0" value="{{s.rejectsControl.value}}"
                    data-key="{{s.rejectsControl.key}}" disabled="{{s.rejectsControl.locked}}"
                    r-change="stageField(s.rejectsControl, event)">
                  <span class="lock-reason" if="s.rejectsControl.locked">{{s.rejectsControl.reason}}</span>
                </dd>
              </dl>
            </li>
          </ul>
        </div>

        <div class="pane" if="showSettings">
          <dl class="agent-settings">
            <dt>Name</dt>
            <dd class="locked">{{definition.name}}<span class="lock-reason">the address every trace, pin and finding uses</span></dd>
            <dt>Role</dt>
            <dd class="{{definition.roleControl.rowClass}}">
              <select class="field narrow" data-key="{{definition.roleControl.key}}"
                disabled="{{definition.roleControl.locked}}" r-change="stageField(definition.roleControl, event)">
                <option value="worker" selected="{{definition.isWorker}}">worker</option>
                <option value="coordinator" selected="{{definition.isCoordinator}}">coordinator</option>
              </select>
              <span class="lock-reason" if="definition.roleControl.locked">{{definition.roleControl.reason}}</span>
            </dd>
            <dt>Model</dt><dd>{{definition.adapter}}</dd>
            <dt>Phases</dt><dd>{{definition.phaseOrder}}</dd>
            <dt if="definition.hasSideQuests">Side quests</dt>
            <dd if="definition.hasSideQuests">{{definition.sideQuests}}</dd>
          </dl>
        </div>

        <div class="pane" if="showIssues">
          <p class="findings-actions">
            <button class="copy-all" r-click="copyAll()">Copy all issues</button>
          </p>
          <ul class="findings">
            <li loop="f in findings" class="{{f.rowClass}}">
              <span class="finding-field">{{f.field}}</span>
              <span class="finding-code">{{f.code}}</span>
              <button class="copy-one" title="Copy this issue" r-click="copy(f)">Copy</button>
              <p class="finding-message">{{f.message}}</p>
              <p class="finding-hint">{{f.hint}}</p>
              <pre class="finding-example">{{f.example}}</pre>
            </li>
          </ul>
        </div>

        <div class="pane timeline" if="showRun">
          <p class="hint" unless="hasTimeline">No run yet. Diagnostics appear here as phases finish.</p>

          <section class="pins" if="hasPins">
            <p class="hint">
              Held fixed. The next run starts at <strong>{{resumeAt}}</strong> and replays these instead of producing them.
              <button class="unpin" r-click="unpinAll()">Unpin all</button>
            </p>
            <ol>
              <li loop="p in pins">
                <label for="{{p.inputId}}">{{p.phase}}</label>
                <textarea id="{{p.inputId}}" class="pin-json" data-phase="{{p.phase}}" rows="4" r-change="editPin(p, event)">{{p.json}}</textarea>
                <span class="pin-error" if="p.hasError">{{p.error}}</span>
              </li>
            </ol>
          </section>

          <p class="rollup" if="hasRollup">
            {{rollup.phases}} phases · {{rollup.turns}} turns · {{rollup.rejectedDeliverables}} rejected deliverables ·
            {{rollup.nudges}} nudges · {{rollup.toolErrors}} tool errors · {{rollup.checklistFailures}} checklist failures ·
            {{rollup.budgetExhaustions}} budget exhaustions · {{rollup.subAgentRuns}} sub-agent runs
          </p>
          <p class="clean" if="clean">Nothing was retried, nudged, or refused. The tree ran the way it reads.</p>

          <ol class="events">
            <li loop="e in timeline" class="{{e.rowClass}}">
              <span class="{{e.markerClass}}"></span>
              <span class="label">{{e.label}}</span>
              <span class="note">{{e.detail}}</span>
              <button class="pin" if="e.canPin" r-click="pinThrough(e)">{{e.pinLabel}}</button>
              <span class="problems" if="e.hasProblems">{{e.problems}}</span>
            </li>
          </ol>

          <div if="hasOutput">
            <h4>Final deliverable</h4>
            <pre class="deliverable">{{output}}</pre>
          </div>
        </div>

      </div>
    </section>

  </div>

  <section class="pending-edits" if="hasPendingEdits">
    <ol>
      <li loop="e in pendingEdits">
        <span class="pending-what">{{e.display}}</span>
        <button class="unstage" r-click="unstage(e)">Drop</button>
      </li>
    </ol>
  </section>

  <footer class="status-controls">
    <span class="{{validityClass}}">{{validity}}</span>
    <span class="edit-error" if="hasEditError">{{editError}}</span>
    <span class="spacer"></span>
    <span class="pending-count" if="hasPendingEdits">{{pendingCount}} unsaved</span>
    <button class="discard" r-click="discardEdits()" if="hasPendingEdits">Discard</button>
    <button class="save" r-click="saveDefinition()" if="hasPendingEdits">Save Definition</button>
  </footer>

</div>
`;
