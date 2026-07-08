#!/usr/bin/env -S gjs -m

import Adw from "gi://Adw?version=1";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";

const APP_ID = "dev.agentworkbench.App";
const APP_NAME = "Agent Workbench";

function coreCommand(args) {
  const configured = GLib.getenv("AGENT_WORKBENCH_CORE");
  if (configured) {
    return [configured, ...args];
  }
  const sourceCore = GLib.build_filenamev([GLib.get_current_dir(), "linux/src/supacode-linux.mjs"]);
  if (GLib.file_test(sourceCore, GLib.FileTest.EXISTS)) {
    return ["node", sourceCore, ...args];
  }
  return ["supacode-linux", ...args];
}

function runCore(args) {
  const command = coreCommand(args);
  const proc = Gio.Subprocess.new(command, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
  const [, stdout, stderr] = proc.communicate_utf8(null, null);
  if (proc.get_successful()) {
    return stdout.trim();
  }
  throw new Error(stderr.trim() || `${command.join(" ")} failed`);
}

function parseCoreJSON(args, fallback) {
  const output = runCore(args);
  return output ? JSON.parse(output) : fallback;
}

const WorkbenchWindow = GObject.registerClass(
  class WorkbenchWindow extends Adw.ApplicationWindow {
    _init(application) {
      super._init({
        application,
        title: APP_NAME,
        default_width: 1280,
        default_height: 820,
      });

      this.repositories = [];
      this.worktrees = [];
      this.terminals = [];
      this.agents = [];
      this.prs = [];
      this.refreshErrors = [];

      const toolbarView = new Adw.ToolbarView();
      const header = new Adw.HeaderBar();
      header.set_title_widget(new Gtk.Label({ label: APP_NAME, css_classes: ["title-2"] }));
      toolbarView.add_top_bar(header);

      const refreshButton = new Gtk.Button({ icon_name: "view-refresh-symbolic", tooltip_text: "Refresh state" });
      refreshButton.connect("clicked", () => this.refresh());
      header.pack_end(refreshButton);

      const commandButton = new Gtk.Button({ icon_name: "system-run-symbolic", tooltip_text: "Open command palette" });
      commandButton.connect("clicked", () => this.showCommandPalette());
      header.pack_end(commandButton);

      const root = new Gtk.Paned({ orientation: Gtk.Orientation.HORIZONTAL, wide_handle: true });
      toolbarView.set_content(root);
      this.set_content(toolbarView);

      this.sidebar = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        margin_top: 12,
        margin_bottom: 12,
        margin_start: 12,
        margin_end: 12,
      });
      this.sidebar.set_size_request(340, -1);
      root.set_start_child(this.sidebar);

      this.repositoryList = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.SINGLE });
      this.worktreeList = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.SINGLE });
      this.agentList = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
      this.prList = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });

      this.sidebar.append(sectionLabel("Repositories"));
      this.sidebar.append(scroll(this.repositoryList));
      this.sidebar.append(sectionLabel("Worktrees"));
      this.sidebar.append(scroll(this.worktreeList));

      const main = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
        margin_top: 12,
        margin_bottom: 12,
        margin_start: 12,
        margin_end: 12,
      });
      root.set_end_child(main);

      this.statusLabel = new Gtk.Label({ xalign: 0, wrap: true });
      main.append(this.statusLabel);

      const terminalFrame = new Gtk.Frame({ label: "Terminal surfaces" });
      this.terminalList = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
      terminalFrame.set_child(scroll(this.terminalList));
      terminalFrame.set_vexpand(true);
      main.append(terminalFrame);

      const details = new Gtk.Paned({ orientation: Gtk.Orientation.HORIZONTAL, wide_handle: true });
      const agentsFrame = new Gtk.Frame({ label: "Agent integrations" });
      agentsFrame.set_child(scroll(this.agentList));
      const prsFrame = new Gtk.Frame({ label: "Pull requests" });
      prsFrame.set_child(scroll(this.prList));
      details.set_start_child(agentsFrame);
      details.set_end_child(prsFrame);
      main.append(details);

      this.refresh();
    }

    refresh() {
      try {
        runCore(["init"]);
        runCore(["agent", "auto-install"]);
        this.repositories = parseCoreJSON(["repo", "list"], []);
        this.agents = parseCoreJSON(["agent", "status"], []);
        this.prs = parseCoreJSON(["github", "pr", "list"], []);
        this.terminals = parseCoreJSON(["terminal", "list"], []);
        this.worktrees = [];
        this.refreshErrors = [];
        for (const repo of this.repositories) {
          try {
            const repoWorktrees = parseCoreJSON(["worktree", "list", "--repo", repo.id], []);
            this.worktrees.push(...repoWorktrees);
          } catch (error) {
            this.refreshErrors.push(`${repo.displayName || repo.rootPath}: ${error.message}`);
          }
        }
        this.render();
      } catch (error) {
        this.statusLabel.set_label(`Unable to refresh state: ${error.message}`);
      }
    }

    render() {
      fillList(this.repositoryList, this.repositories, (repo) =>
        row(
          repo.displayName || repo.rootPath,
          repo.kind === "remote" ? `${repo.remoteHost}:${repo.rootPath}` : repo.rootPath,
          repo.kind === "remote" ? "network-server-symbolic" : "folder-symbolic"
        )
      );
      fillList(this.worktreeList, this.worktrees, (worktree) =>
        row(worktree.branchName || worktree.workingDirectory, worktree.detail || worktree.workingDirectory, "vcs-branch-symbolic")
      );
      fillList(this.terminalList, this.terminals, (terminal) =>
        row(terminal.title || terminal.surfaceID, terminal.workingDirectory || terminal.surfaceID, "utilities-terminal-symbolic")
      );
      fillList(this.agentList, this.agents, (agent) =>
        row(agent.agent, agent.error || agent.state, agent.state === "installed" ? "emblem-ok-symbolic" : "dialog-warning-symbolic")
      );
      fillList(this.prList, this.prs, (pr) =>
        row(`#${pr.number} ${pr.title}`, `${pr.checksState} / ${pr.mergeReadiness}`, "vcs-merge-request-symbolic")
      );
      const status =
        `${this.repositories.length} repositories, ${this.worktrees.length} worktrees, ` +
        `${this.terminals.filter((terminal) => !terminal.isClosed).length} open surfaces`;
      this.statusLabel.set_label(
        this.refreshErrors.length > 0 ? `${status}. ${this.refreshErrors.length} repository refresh errors.` : status
      );
    }

    showCommandPalette() {
      const dialog = new Adw.MessageDialog({
        transient_for: this,
        heading: "Command palette",
        body: "The command palette shell is wired here; action routing will be filled in as GTK terminal workflows land.",
      });
      dialog.add_response("close", "Close");
      dialog.present();
    }
  }
);

const WorkbenchApplication = GObject.registerClass(
  class WorkbenchApplication extends Adw.Application {
    _init() {
      super._init({ application_id: APP_ID, flags: Gio.ApplicationFlags.DEFAULT_FLAGS });
    }

    vfunc_activate() {
      const window = new WorkbenchWindow(this);
      window.present();
    }
  }
);

function sectionLabel(label) {
  return new Gtk.Label({ label, xalign: 0, css_classes: ["heading"] });
}

function scroll(child) {
  const scrolled = new Gtk.ScrolledWindow({ child, vexpand: true, hexpand: true });
  scrolled.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC);
  return scrolled;
}

function row(title, subtitle, iconName) {
  const listRow = new Gtk.ListBoxRow();
  const box = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 8,
    margin_top: 8,
    margin_bottom: 8,
    margin_start: 8,
    margin_end: 8,
  });
  box.append(new Gtk.Image({ icon_name: iconName, pixel_size: 18 }));
  const text = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 });
  text.append(new Gtk.Label({ label: title, xalign: 0, ellipsize: 3 }));
  text.append(new Gtk.Label({ label: subtitle || "", xalign: 0, ellipsize: 3, css_classes: ["dim-label"] }));
  box.append(text);
  listRow.set_child(box);
  return listRow;
}

function fillList(list, items, createRow) {
  while (true) {
    const child = list.get_first_child();
    if (!child) break;
    list.remove(child);
  }
  if (items.length === 0) {
    list.append(row("Nothing yet", "Use the CLI or command palette to add state", "dialog-information-symbolic"));
    return;
  }
  for (const item of items) {
    list.append(createRow(item));
  }
}

new WorkbenchApplication().run([APP_NAME, ...ARGV]);
