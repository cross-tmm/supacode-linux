#include <QAction>
#include <QAbstractItemView>
#include <QApplication>
#include <QBoxLayout>
#include <QCommandLineOption>
#include <QCommandLineParser>
#include <QCoreApplication>
#include <QDateTime>
#include <QDialog>
#include <QDir>
#include <QFileInfo>
#include <QFrame>
#include <QGuiApplication>
#include <QHeaderView>
#include <QHBoxLayout>
#include <QIcon>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QKeyEvent>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QListWidgetItem>
#include <QMainWindow>
#include <QMenu>
#include <QMessageBox>
#include <QPainter>
#include <QPair>
#include <QPixmap>
#include <QPoint>
#include <QProcess>
#include <QProcessEnvironment>
#include <QPushButton>
#include <QScreen>
#include <QScrollArea>
#include <QShortcut>
#include <QSplitter>
#include <QStackedWidget>
#include <QTabWidget>
#include <QTextEdit>
#include <QTimer>
#include <QToolButton>
#include <QTreeWidget>
#include <QTreeWidgetItem>
#include <QVBoxLayout>

#include <algorithm>
#include <functional>

namespace {

constexpr int SidebarMinWidth = 220;
constexpr int SidebarIdealWidth = 260;
constexpr int SidebarMaxWidth = 320;
constexpr int InspectorIdealWidth = 320;
constexpr int PaletteWidth = 500;
constexpr int PaletteHeight = 254;

struct Repository {
  QString id;
  QString kind;
  QString rootPath;
  QString remoteHost;
  QString displayName;
};

struct Worktree {
  QString id;
  QString repositoryID;
  QString workingDirectory;
  QString branchName;
  QString detail;
  bool isMissing = false;
  bool isPinned = false;
  bool isArchived = false;
};

struct TerminalSurface {
  QString surfaceID;
  QString tabID;
  QString worktreeID;
  QString title;
  QString workingDirectory;
  QString launchBackend;
  QString launchCommand;
  bool isClosed = false;
};

struct AgentState {
  QString agent;
  QString state;
  QString error;
};

struct PullRequestState {
  QString worktreeID;
  int number = 0;
  QString title;
  QString checksState;
  QString mergeReadiness;
  QString url;
};

struct NotificationItem {
  QString id;
  QString worktreeID;
  QString surfaceID;
  QString title;
  QString body;
  bool isRead = false;
  bool isDismissed = false;
};

struct ScriptItem {
  QString id;
  QString scope;
  QString repositoryID;
  QString kind;
  QString name;
  QString command;
  bool isEnabled = true;
};

struct CommandPaletteEntry {
  QString id;
  QString title;
  QString subtitle;
  QString kind;
  QString worktreeID;
  QString scriptID;
};

struct AppSnapshot {
  QString selectedWorktreeID;
  QString selectedTabID;
  QString selectedSurfaceID;
  QVector<Repository> repositories;
  QVector<Worktree> worktrees;
  QVector<TerminalSurface> terminals;
  QVector<AgentState> agents;
  QVector<PullRequestState> pullRequests;
  QVector<NotificationItem> notifications;
  QVector<ScriptItem> scripts;
  QVector<CommandPaletteEntry> commandPaletteItems;
};

QString jsonString(const QJsonObject &object, const QString &key) {
  return object.value(key).toString();
}

bool jsonBool(const QJsonObject &object, const QString &key) {
  const auto value = object.value(key);
  if (value.isBool()) return value.toBool();
  if (value.isDouble()) return value.toInt() != 0;
  return false;
}

QLabel *label(const QString &text, const QString &className = {}) {
  auto *widget = new QLabel(text);
  if (!className.isEmpty()) widget->setProperty("class", className);
  widget->setTextInteractionFlags(Qt::TextSelectableByMouse);
  widget->setWordWrap(true);
  return widget;
}

QFrame *line() {
  auto *frame = new QFrame;
  frame->setFrameShape(QFrame::HLine);
  frame->setFrameShadow(QFrame::Plain);
  frame->setProperty("class", "separator");
  return frame;
}

QString iconPath(const QString &name) {
  return QStringLiteral(":/icons/%1").arg(name);
}

class CoreClient {
public:
  explicit CoreClient(QString dbPath) : dbPath_(std::move(dbPath)) {}

  bool init(QString *error = nullptr) { return run(QProcessEnvironment(), {"init"}, nullptr, error); }

  AppSnapshot snapshot(QString *error = nullptr) {
    QJsonDocument document;
    AppSnapshot result;
    if (!runJson({"app", "snapshot"}, &document, error)) return result;
    const auto root = document.object();
    result.selectedWorktreeID = jsonString(root, "selectedWorktreeID");
    result.selectedTabID = jsonString(root, "selectedTabID");
    result.selectedSurfaceID = jsonString(root, "selectedSurfaceID");
    for (const auto value : root.value("repositories").toArray()) {
      const auto object = value.toObject();
      result.repositories.push_back({
        jsonString(object, "id"),
        jsonString(object, "kind"),
        jsonString(object, "rootPath"),
        jsonString(object, "remoteHost"),
        jsonString(object, "displayName"),
      });
    }
    for (const auto value : root.value("worktrees").toArray()) {
      const auto object = value.toObject();
      result.worktrees.push_back({
        jsonString(object, "id"),
        jsonString(object, "repositoryID"),
        jsonString(object, "workingDirectory"),
        jsonString(object, "branchName"),
        jsonString(object, "detail"),
        jsonBool(object, "isMissing"),
        jsonBool(object, "isPinned"),
        jsonBool(object, "isArchived"),
      });
    }
    for (const auto value : root.value("terminalSurfaces").toArray()) {
      const auto object = value.toObject();
      result.terminals.push_back({
        jsonString(object, "surfaceID"),
        jsonString(object, "tabID"),
        jsonString(object, "worktreeID"),
        jsonString(object, "title"),
        jsonString(object, "workingDirectory"),
        jsonString(object, "launchBackend"),
        jsonString(object, "launchCommand"),
        jsonBool(object, "isClosed"),
      });
    }
    for (const auto value : root.value("agents").toArray()) {
      const auto object = value.toObject();
      result.agents.push_back({
        jsonString(object, "agent"),
        jsonString(object, "installState"),
        jsonString(object, "lastError"),
      });
    }
    for (const auto value : root.value("pullRequests").toArray()) {
      const auto object = value.toObject();
      result.pullRequests.push_back({
        jsonString(object, "worktreeID"),
        object.value("number").toInt(),
        jsonString(object, "title"),
        jsonString(object, "checksState"),
        jsonString(object, "mergeReadiness"),
        jsonString(object, "url"),
      });
    }
    for (const auto value : root.value("notifications").toArray()) {
      const auto object = value.toObject();
      result.notifications.push_back({
        jsonString(object, "id"),
        jsonString(object, "worktreeID"),
        jsonString(object, "surfaceID"),
        jsonString(object, "title"),
        jsonString(object, "body"),
        jsonBool(object, "isRead"),
        jsonBool(object, "isDismissed"),
      });
    }
    for (const auto value : root.value("scripts").toArray()) {
      const auto object = value.toObject();
      result.scripts.push_back({
        jsonString(object, "id"),
        jsonString(object, "scope"),
        jsonString(object, "repositoryID"),
        jsonString(object, "kind"),
        jsonString(object, "name"),
        jsonString(object, "command"),
        !object.contains("isEnabled") || jsonBool(object, "isEnabled"),
      });
    }
    for (const auto value : root.value("commandPaletteItems").toArray()) {
      const auto object = value.toObject();
      result.commandPaletteItems.push_back({
        jsonString(object, "id"),
        jsonString(object, "title"),
        jsonString(object, "subtitle"),
        jsonString(object, "kind"),
        jsonString(object, "worktreeID"),
        jsonString(object, "scriptID"),
      });
    }
    return result;
  }

  QVector<Repository> repositories(QString *error = nullptr) {
    QJsonDocument document;
    QVector<Repository> result;
    if (!runJson({"repo", "list"}, &document, error)) return result;
    for (const auto value : document.array()) {
      const auto object = value.toObject();
      result.push_back({
        jsonString(object, "id"),
        jsonString(object, "kind"),
        jsonString(object, "rootPath"),
        jsonString(object, "remoteHost"),
        jsonString(object, "displayName"),
      });
    }
    return result;
  }

  QVector<Worktree> worktrees(const QString &repositoryID, QString *error = nullptr) {
    QJsonDocument document;
    QVector<Worktree> result;
    if (!runJson({"worktree", "list", "--repo", repositoryID}, &document, error)) return result;
    for (const auto value : document.array()) {
      const auto object = value.toObject();
      result.push_back({
        jsonString(object, "id"),
        jsonString(object, "repositoryID"),
        jsonString(object, "workingDirectory"),
        jsonString(object, "branchName"),
        jsonString(object, "detail"),
        jsonBool(object, "isMissing"),
        jsonBool(object, "isPinned"),
        jsonBool(object, "isArchived"),
      });
    }
    return result;
  }

  QVector<TerminalSurface> terminals(const QString &worktreeID = {}, QString *error = nullptr) {
    QStringList args{"terminal", "list"};
    if (!worktreeID.isEmpty()) args << "--worktree" << worktreeID;
    QJsonDocument document;
    QVector<TerminalSurface> result;
    if (!runJson(args, &document, error)) return result;
    for (const auto value : document.array()) {
      const auto object = value.toObject();
      result.push_back({
        jsonString(object, "surfaceID"),
        jsonString(object, "tabID"),
        jsonString(object, "worktreeID"),
        jsonString(object, "title"),
        jsonString(object, "workingDirectory"),
        jsonString(object, "launchBackend"),
        jsonString(object, "launchCommand"),
        jsonBool(object, "isClosed"),
      });
    }
    return result;
  }

  QVector<AgentState> agents(QString *error = nullptr) {
    QJsonDocument document;
    QVector<AgentState> result;
    if (!runJson({"agent", "status"}, &document, error)) return result;
    for (const auto value : document.array()) {
      const auto object = value.toObject();
      result.push_back({
        jsonString(object, "agent"),
        jsonString(object, "state"),
        jsonString(object, "error"),
      });
    }
    return result;
  }

  QVector<PullRequestState> pullRequests(QString *error = nullptr) {
    QJsonDocument document;
    QVector<PullRequestState> result;
    if (!runJson({"github", "pr", "list"}, &document, error)) return result;
    for (const auto value : document.array()) {
      const auto object = value.toObject();
      result.push_back({
        jsonString(object, "worktreeID"),
        object.value("number").toInt(),
        jsonString(object, "title"),
        jsonString(object, "checksState"),
        jsonString(object, "mergeReadiness"),
        jsonString(object, "url"),
      });
    }
    return result;
  }

  bool createTerminal(const QString &worktreeID, QString *error = nullptr) {
    return run(QProcessEnvironment(), {"terminal", "create", "--worktree", worktreeID}, nullptr, error);
  }

private:
  QStringList baseCommand() const {
    const QString configured = qEnvironmentVariable("SUPACODE_CORE");
    if (!configured.isEmpty()) return {configured};
    const QString appDir = QCoreApplication::applicationDirPath();
    const QString sourceCore = QDir::current().absoluteFilePath("linux/src/supacode-linux.mjs");
    if (QFileInfo::exists(sourceCore)) return {"node", sourceCore};
    const QString installedCore = QDir(appDir).absoluteFilePath("../lib/supacode-linux/supacode-linux.mjs");
    if (QFileInfo::exists(installedCore)) return {"node", QFileInfo(installedCore).canonicalFilePath()};
    return {"supacode-linux"};
  }

  bool runJson(const QStringList &args, QJsonDocument *document, QString *error) {
    QByteArray output;
    if (!run(QProcessEnvironment(), args, &output, error)) return false;
    QJsonParseError parseError;
    const auto parsed = QJsonDocument::fromJson(output, &parseError);
    if (parseError.error != QJsonParseError::NoError) {
      if (error) *error = parseError.errorString();
      return false;
    }
    if (document) *document = parsed;
    return true;
  }

  bool run(const QProcessEnvironment &extraEnv, const QStringList &args, QByteArray *stdoutData, QString *error) {
    QStringList command = baseCommand();
    const QString program = command.takeFirst();
    QStringList finalArgs = command;
    if (!dbPath_.isEmpty()) finalArgs << "--db" << dbPath_;
    finalArgs << args;

    QProcess process;
    auto env = QProcessEnvironment::systemEnvironment();
    if (!extraEnv.isEmpty()) {
      for (const auto &key : extraEnv.keys()) env.insert(key, extraEnv.value(key));
    }
    process.setProcessEnvironment(env);
    process.start(program, finalArgs);
    if (!process.waitForFinished(30000)) {
      process.kill();
      if (error) *error = QStringLiteral("%1 timed out").arg(program);
      return false;
    }
    if (process.exitStatus() != QProcess::NormalExit || process.exitCode() != 0) {
      if (error) *error = QString::fromUtf8(process.readAllStandardError()).trimmed();
      if (error && error->isEmpty()) *error = QStringLiteral("%1 failed").arg(program);
      return false;
    }
    if (stdoutData) *stdoutData = process.readAllStandardOutput();
    return true;
  }

  QString dbPath_;
};

class CommandPalette final : public QDialog {
public:
  explicit CommandPalette(QWidget *parent) : QDialog(parent, Qt::Tool | Qt::FramelessWindowHint) {
    setObjectName("commandPalette");
    setFixedSize(PaletteWidth, PaletteHeight);
    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(0);

    query_ = new QLineEdit;
    query_->setPlaceholderText("Search for actions or branches...");
    query_->setFixedHeight(48);
    query_->setObjectName("paletteQuery");
    layout->addWidget(query_);
    layout->addWidget(line());

    list_ = new QListWidget;
    list_->setObjectName("paletteList");
    list_->setFrameShape(QFrame::NoFrame);
    layout->addWidget(list_);

    connect(query_, &QLineEdit::textChanged, this, [this] { filter(); });
    connect(query_, &QLineEdit::returnPressed, this, [this] { activateCurrent(); });
    connect(list_, &QListWidget::itemActivated, this, [this](QListWidgetItem *item) {
      if (item) emitActivation(item->data(Qt::UserRole).toString());
    });
  }

  void setItems(const QStringList &items) {
    allItems_ = items;
    filter();
  }

  void showCentered(QWidget *owner) {
    query_->clear();
    filter();
    if (owner) {
      const auto global = owner->mapToGlobal(owner->rect().center());
      move(global.x() - width() / 2, owner->mapToGlobal(QPoint(0, 0)).y() + owner->height() * 0.3);
    }
    show();
    raise();
    activateWindow();
    query_->setFocus(Qt::OtherFocusReason);
  }

  std::function<void(QString)> onActivate;

protected:
  void keyPressEvent(QKeyEvent *event) override {
    const bool commandLike = event->modifiers().testFlag(Qt::ControlModifier) || event->modifiers().testFlag(Qt::MetaModifier);
    if (event->key() == Qt::Key_Escape) {
      hide();
      return;
    }
    if ((event->key() == Qt::Key_P && event->modifiers().testFlag(Qt::ControlModifier)) || event->key() == Qt::Key_Up) {
      moveSelection(-1);
      return;
    }
    if ((event->key() == Qt::Key_N && event->modifiers().testFlag(Qt::ControlModifier)) || event->key() == Qt::Key_Down) {
      moveSelection(1);
      return;
    }
    if (commandLike && event->key() >= Qt::Key_1 && event->key() <= Qt::Key_5) {
      const int row = event->key() - Qt::Key_1;
      if (row < list_->count()) {
        emitActivation(list_->item(row)->data(Qt::UserRole).toString());
      }
      return;
    }
    QDialog::keyPressEvent(event);
  }

private:
  void filter() {
    const QString needle = query_->text().trimmed().toLower();
    list_->clear();
    for (const auto &item : allItems_) {
      if (!needle.isEmpty() && !item.toLower().contains(needle)) continue;
      auto *row = new QListWidgetItem(item);
      row->setData(Qt::UserRole, item);
      list_->addItem(row);
    }
    if (list_->count() > 0) list_->setCurrentRow(0);
  }

  void moveSelection(int delta) {
    if (list_->count() == 0) return;
    const int next = std::clamp(list_->currentRow() + delta, 0, list_->count() - 1);
    list_->setCurrentRow(next);
  }

  void activateCurrent() {
    if (auto *item = list_->currentItem()) emitActivation(item->data(Qt::UserRole).toString());
  }

  void emitActivation(const QString &item) {
    hide();
    if (onActivate) onActivate(item);
  }

  QLineEdit *query_ = nullptr;
  QListWidget *list_ = nullptr;
  QStringList allItems_;
};

class SettingsWindow final : public QDialog {
public:
  explicit SettingsWindow(QWidget *parent = nullptr) : QDialog(parent) {
    setWindowTitle("Settings");
    setMinimumSize(750, 500);
    auto *root = new QHBoxLayout(this);
    auto *splitter = new QSplitter;
    root->addWidget(splitter);
    sidebar_ = new QListWidget;
    sidebar_->setObjectName("settingsSidebar");
    sidebar_->setFixedWidth(220);
    pages_ = new QStackedWidget;
    splitter->addWidget(sidebar_);
    splitter->addWidget(pages_);

    addPage("General", "Appearance, terminal persistence, editor, analytics, and arbitrary action policy.");
    addPage("Notifications", "System notifications, sounds, badges, and unread worktree prioritization.");
    addPage("Worktrees", "Creation prompts, base folders, ignored/untracked copy policy, and cleanup.");
    addPage("Developer", "Deeplinks, CLI install, and coding-agent integrations.");
    addPage("GitHub", "GitHub CLI status, pull request merge strategy, and merged worktree actions.");
    addPage("Shortcuts", "Keyboard shortcut table and conflict review.");
    addPage("Global Scripts", "Scripts available from every repository toolbar and command palette.");
    addPage("Updates", "Update channel, check cadence, and automatic downloads.");
    connect(sidebar_, &QListWidget::currentRowChanged, pages_, &QStackedWidget::setCurrentIndex);
    sidebar_->setCurrentRow(0);
  }

private:
  void addPage(const QString &title, const QString &body) {
    sidebar_->addItem(title);
    auto *page = new QWidget;
    auto *layout = new QVBoxLayout(page);
    layout->setContentsMargins(28, 24, 28, 24);
    layout->setSpacing(14);
    layout->addWidget(label(title, "pageTitle"));
    layout->addWidget(label(body, "muted"));
    layout->addWidget(formCard({
      {"Status", "Implemented as a native Qt parity pane shell."},
      {"Source", "Mirrors the SwiftUI Settings NavigationSplitView structure."},
      {"Next", "Wire each row to persisted SettingsFile fields and validation."},
    }));
    layout->addStretch();
    pages_->addWidget(page);
  }

  QFrame *formCard(const QVector<QPair<QString, QString>> &rows) {
    auto *frame = new QFrame;
    frame->setProperty("class", "card");
    auto *layout = new QVBoxLayout(frame);
    layout->setContentsMargins(16, 12, 16, 12);
    layout->setSpacing(10);
    for (const auto &row : rows) {
      auto *line = new QWidget;
      auto *h = new QHBoxLayout(line);
      h->setContentsMargins(0, 0, 0, 0);
      h->addWidget(label(row.first));
      h->addStretch();
      auto *value = label(row.second, "muted");
      value->setAlignment(Qt::AlignRight | Qt::AlignVCenter);
      h->addWidget(value, 1);
      layout->addWidget(line);
    }
    return frame;
  }

  QListWidget *sidebar_ = nullptr;
  QStackedWidget *pages_ = nullptr;
};

class SupacodeWindow final : public QMainWindow {
public:
  explicit SupacodeWindow(QString dbPath, QWidget *parent = nullptr)
    : QMainWindow(parent), core_(std::move(dbPath)) {
    setWindowTitle("Supacode");
    setWindowIcon(QIcon(iconPath("app.png")));
    resize(1280, 820);
    buildActions();
    buildUi();
    refresh();
  }

  bool refresh() {
    QString error;
    core_.init(&error);
    refreshErrors_.clear();
    const auto snapshot = core_.snapshot(&error);
    if (!error.isEmpty()) {
      refreshErrors_.push_back(error);
      repositories_ = core_.repositories(&error);
      worktrees_.clear();
      for (const auto &repo : repositories_) {
        QString worktreeError;
        auto rows = core_.worktrees(repo.id, &worktreeError);
        if (!worktreeError.isEmpty()) refreshErrors_.push_back(repo.displayName + ": " + worktreeError);
        for (const auto &row : rows) worktrees_.push_back(row);
      }
      terminals_ = core_.terminals({}, &error);
      agents_ = core_.agents(&error);
      pullRequests_ = core_.pullRequests(&error);
      notifications_.clear();
      scripts_.clear();
      paletteEntries_.clear();
    } else {
      repositories_ = snapshot.repositories;
      worktrees_ = snapshot.worktrees;
      terminals_ = snapshot.terminals;
      agents_ = snapshot.agents;
      pullRequests_ = snapshot.pullRequests;
      notifications_ = snapshot.notifications;
      scripts_ = snapshot.scripts;
      paletteEntries_ = snapshot.commandPaletteItems;
      if (selectedWorktreeID_.isEmpty() && !snapshot.selectedWorktreeID.isEmpty()) {
        selectedWorktreeID_ = snapshot.selectedWorktreeID;
      }
    }
    renderSidebar();
    renderCurrentDetail();
    updatePaletteItems();
    return refreshErrors_.isEmpty();
  }

  void saveScreenshot(const QString &path) {
    QPixmap pixmap(size());
    render(&pixmap);
    pixmap.save(path);
  }

private:
  enum ItemType { RepositoryItem = QTreeWidgetItem::UserType + 1, WorktreeItem };

  void buildActions() {
    auto *palette = new QAction("Command Palette", this);
    palette->setShortcut(QKeySequence("Ctrl+P"));
    addAction(palette);
    connect(palette, &QAction::triggered, this, [this] { showPalette(); });

    auto *settings = new QAction("Settings", this);
    settings->setShortcut(QKeySequence("Ctrl+,"));
    addAction(settings);
    connect(settings, &QAction::triggered, this, [this] { showSettings(); });

    auto *refreshAction = new QAction("Refresh", this);
    refreshAction->setShortcut(QKeySequence("Ctrl+Shift+R"));
    addAction(refreshAction);
    connect(refreshAction, &QAction::triggered, this, [this] { refresh(); });
  }

  void buildUi() {
    auto *splitter = new QSplitter(Qt::Horizontal);
    splitter->setObjectName("mainSplit");
    setCentralWidget(splitter);

    auto *sidebarHost = new QWidget;
    sidebarHost->setObjectName("sidebarHost");
    sidebarHost->setMinimumWidth(SidebarMinWidth);
    sidebarHost->setMaximumWidth(SidebarMaxWidth);
    auto *sidebarLayout = new QVBoxLayout(sidebarHost);
    sidebarLayout->setContentsMargins(10, 10, 8, 10);
    sidebarLayout->setSpacing(8);

    auto *top = new QWidget;
    auto *topLayout = new QHBoxLayout(top);
    topLayout->setContentsMargins(0, 0, 0, 0);
    topLayout->addWidget(label("Supacode", "sidebarTitle"));
    topLayout->addStretch();
    auto *addButton = new QToolButton;
    addButton->setText("+");
    addButton->setToolTip("Add Repository, Folder, or Remote");
    auto *addMenu = new QMenu(addButton);
    addMenu->addAction("Local Repository or Folder...", this, [this] { showInformation("Open Repository", "Use the CLI or future file picker to add local repositories."); });
    addMenu->addAction("Remote Repository or Folder...", this, [this] { showRemoteDialog(); });
    addMenu->addSeparator();
    addMenu->addAction("Clone Repository...", this, [this] { showCloneDialog(); });
    addButton->setMenu(addMenu);
    addButton->setPopupMode(QToolButton::InstantPopup);
    topLayout->addWidget(addButton);
    sidebarLayout->addWidget(top);

    sidebar_ = new QTreeWidget;
    sidebar_->setHeaderHidden(true);
    sidebar_->setRootIsDecorated(true);
    sidebar_->setIndentation(14);
    sidebar_->setUniformRowHeights(false);
    sidebar_->setSelectionMode(QAbstractItemView::ExtendedSelection);
    sidebar_->setObjectName("sidebar");
    connect(sidebar_, &QTreeWidget::itemSelectionChanged, this, [this] { sidebarSelectionChanged(); });
    sidebarLayout->addWidget(sidebar_, 1);

    auto *bottom = new QFrame;
    bottom->setProperty("class", "bottomCard");
    auto *bottomLayout = new QVBoxLayout(bottom);
    bottomLayout->setContentsMargins(12, 10, 12, 10);
    bottomLayout->setSpacing(4);
    bottomLayout->addWidget(label("Sessions persist across quits", "cardTitle"));
    bottomLayout->addWidget(label("Supacode uses zmx launch plans and falls back to shell mode when zmx is missing.", "muted"));
    sidebarLayout->addWidget(bottom);

    detailStack_ = new QStackedWidget;
    detailStack_->setObjectName("detailStack");
    emptyPage_ = makeEmptyPage();
    worktreePage_ = makeWorktreePage();
    detailStack_->addWidget(emptyPage_);
    detailStack_->addWidget(worktreePage_);
    splitter->addWidget(sidebarHost);
    splitter->addWidget(detailStack_);
    splitter->setSizes({SidebarIdealWidth, 1020});

    palette_ = new CommandPalette(this);
    palette_->onActivate = [this](const QString &item) { handlePaletteItem(item); };
  }

  QWidget *makeEmptyPage() {
    auto *page = new QWidget;
    auto *layout = new QVBoxLayout(page);
    layout->setAlignment(Qt::AlignCenter);
    layout->setSpacing(12);
    auto *icon = label("Open", "emptyIcon");
    icon->setAlignment(Qt::AlignCenter);
    layout->addWidget(icon);
    auto *title = label("Open a repository or folder", "emptyTitle");
    title->setAlignment(Qt::AlignCenter);
    layout->addWidget(title);
    auto *body = label("Select a worktree from the sidebar, add a remote repository, or open the command palette.", "muted");
    body->setAlignment(Qt::AlignCenter);
    layout->addWidget(body);
    auto *buttons = new QWidget;
    auto *h = new QHBoxLayout(buttons);
    h->setContentsMargins(0, 0, 0, 0);
    auto *open = new QPushButton("Open Repository or Folder...");
    auto *remote = new QPushButton("Add Remote Repository...");
    connect(open, &QPushButton::clicked, this, [this] { showInformation("Open Repository", "Local repository file picker will be wired to the existing core add command."); });
    connect(remote, &QPushButton::clicked, this, [this] { showRemoteDialog(); });
    h->addWidget(open);
    h->addWidget(remote);
    layout->addWidget(buttons);
    return page;
  }

  QWidget *makeWorktreePage() {
    auto *page = new QWidget;
    auto *outer = new QHBoxLayout(page);
    outer->setContentsMargins(0, 0, 0, 0);
    auto *splitter = new QSplitter(Qt::Horizontal);
    outer->addWidget(splitter);

    auto *main = new QWidget;
    auto *layout = new QVBoxLayout(main);
    layout->setContentsMargins(16, 12, 12, 0);
    layout->setSpacing(8);

    auto *toolbar = new QFrame;
    toolbar->setObjectName("worktreeToolbar");
    auto *toolbarLayout = new QHBoxLayout(toolbar);
    toolbarLayout->setContentsMargins(0, 0, 0, 0);
    toolbarLayout->setSpacing(8);
    worktreeTitle_ = label("", "toolbarTitle");
    worktreeSubtitle_ = label("", "toolbarSubtitle");
    auto *titleBox = new QWidget;
    auto *titleLayout = new QVBoxLayout(titleBox);
    titleLayout->setContentsMargins(0, 0, 0, 0);
    titleLayout->setSpacing(0);
    titleLayout->addWidget(worktreeTitle_);
    titleLayout->addWidget(worktreeSubtitle_);
    toolbarLayout->addWidget(titleBox, 1);
    toolbarLayout->addWidget(makeToolButton("Open", "Open selected worktree"));
    toolbarLayout->addWidget(makeToolButton("PR", "Pull Request Inspector"));
    toolbarLayout->addWidget(makeToolButton("Bell", "Notifications Inspector"));
    auto *newTerminal = makeToolButton("+", "New Terminal");
    connect(newTerminal, &QPushButton::clicked, this, [this] {
      if (!selectedWorktreeID_.isEmpty()) {
        QString error;
        if (!core_.createTerminal(selectedWorktreeID_, &error)) showError("Unable to create terminal", error);
        refresh();
      }
    });
    toolbarLayout->addWidget(newTerminal);
    layout->addWidget(toolbar);

    terminalTabs_ = new QTabWidget;
    terminalTabs_->setObjectName("terminalTabs");
    terminalTabs_->setTabsClosable(true);
    layout->addWidget(terminalTabs_, 1);

    splitter->addWidget(main);
    inspector_ = makeInspectorPane();
    splitter->addWidget(inspector_);
    splitter->setSizes({900, InspectorIdealWidth});
    return page;
  }

  QPushButton *makeToolButton(const QString &text, const QString &tooltip) {
    auto *button = new QPushButton(text);
    button->setToolTip(tooltip);
    button->setProperty("class", "toolButton");
    return button;
  }

  QWidget *makeInspectorPane() {
    auto *pane = new QWidget;
    pane->setMinimumWidth(280);
    pane->setMaximumWidth(480);
    pane->setObjectName("inspector");
    auto *layout = new QVBoxLayout(pane);
    layout->setContentsMargins(16, 16, 16, 16);
    layout->setSpacing(10);
    layout->addWidget(label("Pull Request", "inspectorTitle"));
    prSummary_ = label("No Pull Request", "muted");
    layout->addWidget(prSummary_);
    layout->addWidget(line());
    layout->addWidget(label("Notifications", "inspectorTitle"));
    notificationSummary_ = label("Agent and terminal notifications appear here.", "muted");
    layout->addWidget(notificationSummary_);
    layout->addStretch();
    return pane;
  }

  void renderSidebar() {
    sidebar_->clear();
    auto *pinned = new QTreeWidgetItem(sidebar_, QStringList("Pinned"));
    pinned->setFirstColumnSpanned(true);
    pinned->setExpanded(true);
    auto *active = new QTreeWidgetItem(sidebar_, QStringList("Active"));
    active->setFirstColumnSpanned(true);
    active->setExpanded(true);

    for (const auto &repo : repositories_) {
      const QString name = repo.displayName.isEmpty() ? QFileInfo(repo.rootPath).fileName() : repo.displayName;
      auto *repoItem = new QTreeWidgetItem(sidebar_, QStringList(name), RepositoryItem);
      repoItem->setIcon(0, QIcon(repo.kind == "remote" ? iconPath("git-default.svg") : iconPath("git-branch.svg")));
      repoItem->setData(0, Qt::UserRole, repo.id);
      repoItem->setToolTip(0, repo.kind == "remote" ? repo.remoteHost + ":" + repo.rootPath : repo.rootPath);
      repoItem->setExpanded(true);
      for (const auto &worktree : worktrees_) {
        if (worktree.repositoryID != repo.id || worktree.isArchived) continue;
        auto *child = new QTreeWidgetItem(repoItem, QStringList(worktree.branchName.isEmpty() ? QFileInfo(worktree.workingDirectory).fileName() : worktree.branchName), WorktreeItem);
        child->setIcon(0, QIcon(iconPath(worktree.isMissing ? "git-pull-request-closed.svg" : "git-branch.svg")));
        child->setData(0, Qt::UserRole, worktree.id);
        child->setToolTip(0, worktree.detail.isEmpty() ? worktree.workingDirectory : worktree.detail);
        if (worktree.isPinned) {
          auto *pinnedItem = new QTreeWidgetItem(pinned, QStringList(child->text(0)), WorktreeItem);
          pinnedItem->setData(0, Qt::UserRole, worktree.id);
        }
      }
    }
    pinned->setHidden(pinned->childCount() == 0);
    active->setHidden(true);
  }

  void renderCurrentDetail() {
    if (selectedWorktreeID_.isEmpty()) {
      detailStack_->setCurrentWidget(emptyPage_);
      return;
    }
    const auto it = std::find_if(worktrees_.begin(), worktrees_.end(), [this](const Worktree &row) { return row.id == selectedWorktreeID_; });
    if (it == worktrees_.end()) {
      detailStack_->setCurrentWidget(emptyPage_);
      return;
    }
    const auto worktree = *it;
    worktreeTitle_->setText(worktree.branchName.isEmpty() ? QFileInfo(worktree.workingDirectory).fileName() : worktree.branchName);
    worktreeSubtitle_->setText(worktree.workingDirectory);
    terminalTabs_->clear();
    int count = 0;
    for (const auto &terminal : terminals_) {
      if (terminal.isClosed || terminal.workingDirectory != worktree.workingDirectory) continue;
      terminalTabs_->addTab(makeTerminalPane(terminal), terminal.title.isEmpty() ? QString("Terminal %1").arg(++count) : terminal.title);
    }
    if (terminalTabs_->count() == 0) {
      TerminalSurface empty;
      empty.title = "No terminals open";
      empty.workingDirectory = worktree.workingDirectory;
      empty.launchBackend = "shell";
      terminalTabs_->addTab(makeTerminalPane(empty), "Terminal");
    }
    updateInspector();
    detailStack_->setCurrentWidget(worktreePage_);
  }

  QWidget *makeTerminalPane(const TerminalSurface &surface) {
    auto *pane = new QWidget;
    pane->setObjectName("terminalPane");
    auto *layout = new QVBoxLayout(pane);
    layout->setAlignment(Qt::AlignCenter);
    layout->setSpacing(8);
    layout->addWidget(label(surface.title.isEmpty() ? "Terminal Surface" : surface.title, "terminalTitle"));
    layout->addWidget(label(QString("Backend: %1").arg(surface.launchBackend.isEmpty() ? "shell" : surface.launchBackend), "muted"));
    layout->addWidget(label(surface.workingDirectory, "mono"));
    if (!surface.launchCommand.isEmpty()) layout->addWidget(label(surface.launchCommand, "mono"));
    return pane;
  }

  void updateInspector() {
    if (pullRequests_.isEmpty()) {
      prSummary_->setText("No Pull Request");
    } else {
      const auto pr = pullRequests_.front();
      prSummary_->setText(QString("#%1 %2\n%3 / %4").arg(pr.number).arg(pr.title, pr.checksState, pr.mergeReadiness));
    }
    const auto unread = std::count_if(notifications_.begin(), notifications_.end(), [](const NotificationItem &item) {
      return !item.isRead && !item.isDismissed;
    });
    notificationSummary_->setText(
      QString("%1 unread notifications, %2 agents, %3 scripts")
        .arg(unread)
        .arg(agents_.size())
        .arg(scripts_.size())
    );
  }

  void sidebarSelectionChanged() {
    const auto items = sidebar_->selectedItems();
    if (items.size() != 1 || items.first()->type() != WorktreeItem) {
      selectedWorktreeID_.clear();
    } else {
      selectedWorktreeID_ = items.first()->data(0, Qt::UserRole).toString();
    }
    renderCurrentDetail();
  }

  void updatePaletteItems() {
    QStringList items;
    if (!paletteEntries_.isEmpty()) {
      for (const auto &entry : paletteEntries_) items << entry.title;
    } else {
      items << "Open Repository or Folder..." << "Add Remote Repository..." << "Clone Repository..." << "Settings" << "Refresh Worktrees" << "Archived Worktrees";
      for (const auto &worktree : worktrees_) items << QString("Switch to %1").arg(worktree.branchName);
    }
    palette_->setItems(items);
  }

  void showPalette() { palette_->showCentered(this); }
  void showSettings() { SettingsWindow(this).exec(); }

  void handlePaletteItem(const QString &item) {
    const auto entry = std::find_if(paletteEntries_.begin(), paletteEntries_.end(), [&item](const CommandPaletteEntry &row) {
      return row.title == item;
    });
    if (entry != paletteEntries_.end()) {
      if (entry->kind == "selectWorktree" && !entry->worktreeID.isEmpty()) {
        selectedWorktreeID_ = entry->worktreeID;
        renderCurrentDetail();
        return;
      }
      if (entry->kind == "openSettings") {
        showSettings();
        return;
      }
      if (entry->kind == "refreshWorktrees") {
        refresh();
        return;
      }
      if (entry->kind == "addRemoteRepository") {
        showRemoteDialog();
        return;
      }
      if (entry->kind == "cloneRepository") {
        showCloneDialog();
        return;
      }
      if (entry->kind == "runScript" || entry->kind == "stopScript") {
        showInformation("Scripts", "Script run and stop actions are available through the Supacode Linux core.");
        return;
      }
    }
    if (item == "Settings" || item == "Open Settings") {
      showSettings();
    } else if (item == "Refresh Worktrees") {
      refresh();
    } else if (item == "Add Remote Repository...") {
      showRemoteDialog();
    } else if (item == "Clone Repository...") {
      showCloneDialog();
    }
  }

  void showRemoteDialog() {
    QDialog dialog(this);
    dialog.setWindowTitle("Connect to Remote Host");
    dialog.setMinimumWidth(420);
    auto *layout = new QVBoxLayout(&dialog);
    layout->addWidget(label("Connect to Remote Host", "pageTitle"));
    layout->addWidget(label("Open a repository or folder on another machine over SSH.", "muted"));
    auto *server = new QLineEdit;
    server->setPlaceholderText("Server");
    auto *path = new QLineEdit;
    path->setPlaceholderText("Path");
    layout->addWidget(server);
    layout->addWidget(path);
    auto buttons = dialogButtons("Cancel", "Add");
    connect(buttons.second, &QPushButton::clicked, &dialog, &QDialog::accept);
    connect(buttons.first, &QPushButton::clicked, &dialog, &QDialog::reject);
    layout->addWidget(buttons.first->parentWidget());
    dialog.exec();
  }

  void showCloneDialog() {
    QDialog dialog(this);
    dialog.setWindowTitle("Clone Repository");
    dialog.setMinimumWidth(460);
    auto *layout = new QVBoxLayout(&dialog);
    layout->addWidget(label("Clone Repository", "pageTitle"));
    layout->addWidget(label("Clone a remote repository into a local folder and add it.", "muted"));
    auto *url = new QLineEdit;
    url->setPlaceholderText("Repository URL");
    auto *folder = new QLineEdit;
    folder->setPlaceholderText("Folder Name");
    layout->addWidget(url);
    layout->addWidget(folder);
    auto buttons = dialogButtons("Cancel", "Clone");
    connect(buttons.second, &QPushButton::clicked, &dialog, &QDialog::accept);
    connect(buttons.first, &QPushButton::clicked, &dialog, &QDialog::reject);
    layout->addWidget(buttons.first->parentWidget());
    dialog.exec();
  }

  QPair<QPushButton *, QPushButton *> dialogButtons(const QString &cancel, const QString &accept) {
    auto *row = new QWidget;
    auto *layout = new QHBoxLayout(row);
    layout->setContentsMargins(0, 12, 0, 0);
    layout->addStretch();
    auto *cancelButton = new QPushButton(cancel, row);
    auto *acceptButton = new QPushButton(accept, row);
    acceptButton->setDefault(true);
    layout->addWidget(cancelButton);
    layout->addWidget(acceptButton);
    return {cancelButton, acceptButton};
  }

  void showInformation(const QString &title, const QString &body) {
    QMessageBox::information(this, title, body);
  }

  void showError(const QString &title, const QString &body) {
    QMessageBox::warning(this, title, body.isEmpty() ? "Unknown error" : body);
  }

  CoreClient core_;
  QVector<Repository> repositories_;
  QVector<Worktree> worktrees_;
  QVector<TerminalSurface> terminals_;
  QVector<AgentState> agents_;
  QVector<PullRequestState> pullRequests_;
  QVector<NotificationItem> notifications_;
  QVector<ScriptItem> scripts_;
  QVector<CommandPaletteEntry> paletteEntries_;
  QVector<QString> refreshErrors_;
  QString selectedWorktreeID_;
  QTreeWidget *sidebar_ = nullptr;
  QStackedWidget *detailStack_ = nullptr;
  QWidget *emptyPage_ = nullptr;
  QWidget *worktreePage_ = nullptr;
  QLabel *worktreeTitle_ = nullptr;
  QLabel *worktreeSubtitle_ = nullptr;
  QTabWidget *terminalTabs_ = nullptr;
  QWidget *inspector_ = nullptr;
  QLabel *prSummary_ = nullptr;
  QLabel *notificationSummary_ = nullptr;
  CommandPalette *palette_ = nullptr;
};

QString supacodeStyleSheet() {
  return R"CSS(
    QMainWindow, QDialog, QWidget {
      background: #202124;
      color: #eceff4;
      font-size: 13px;
    }
    #sidebarHost, #settingsSidebar {
      background: #242528;
      border-right: 1px solid #34363b;
    }
    #sidebar {
      background: transparent;
      border: 0;
      outline: 0;
      show-decoration-selected: 1;
    }
    #sidebar::item, QListWidget::item {
      min-height: 30px;
      padding: 4px 6px;
      border-radius: 5px;
    }
    #sidebar::item:selected, QListWidget::item:selected {
      background: #3b5f8f;
      color: white;
    }
    #worktreeToolbar {
      background: transparent;
      border-bottom: 1px solid #34363b;
      padding-bottom: 8px;
    }
    #terminalTabs::pane {
      border: 0;
      background: #151619;
    }
    #terminalPane {
      background: #151619;
      border: 1px solid #303136;
    }
    #inspector {
      background: #242528;
      border-left: 1px solid #34363b;
    }
    #commandPalette {
      background: rgba(38, 39, 43, 245);
      border: 1px solid #4b4d52;
      border-radius: 12px;
    }
    #paletteQuery {
      border: 0;
      padding: 0 16px;
      font-size: 18px;
      font-weight: 300;
      background: transparent;
    }
    #paletteList {
      background: transparent;
      padding: 8px 10px;
    }
    QLabel[class="sidebarTitle"], QLabel[class="pageTitle"] {
      font-size: 20px;
      font-weight: 650;
    }
    QLabel[class="toolbarTitle"] {
      font-size: 15px;
      font-weight: 650;
    }
    QLabel[class="toolbarSubtitle"], QLabel[class="muted"] {
      color: #aeb4bd;
    }
    QLabel[class="emptyTitle"] {
      font-size: 20px;
      font-weight: 500;
    }
    QLabel[class="emptyIcon"] {
      font-size: 34px;
      color: #8d96a3;
    }
    QLabel[class="terminalTitle"], QLabel[class="inspectorTitle"], QLabel[class="cardTitle"] {
      font-weight: 650;
    }
    QLabel[class="mono"] {
      font-family: "JetBrains Mono", "Noto Sans Mono", monospace;
      color: #b8c0cc;
    }
    QFrame[class="card"], QFrame[class="bottomCard"] {
      background: #2b2d31;
      border: 1px solid #3b3d43;
      border-radius: 8px;
    }
    QFrame[class="separator"] {
      color: #383a40;
      background: #383a40;
      max-height: 1px;
    }
    QPushButton, QToolButton {
      background: #303238;
      border: 1px solid #454851;
      border-radius: 6px;
      padding: 5px 10px;
    }
    QPushButton:hover, QToolButton:hover {
      background: #3a3d45;
    }
    QLineEdit, QTextEdit {
      background: #18191c;
      border: 1px solid #3f424a;
      border-radius: 6px;
      padding: 7px 9px;
      selection-background-color: #3b82f6;
    }
  )CSS";
}

}  // namespace

int main(int argc, char **argv) {
  QApplication app(argc, argv);
  QApplication::setApplicationName("Supacode");
  QApplication::setDesktopFileName("supacode");
  QApplication::setWindowIcon(QIcon(iconPath("app.png")));

  QCommandLineParser parser;
  parser.addHelpOption();
  QCommandLineOption dbOption("db", "SQLite state database path.", "path");
  QCommandLineOption smokeOption("smoke", "Launch and quit after a short delay.");
  QCommandLineOption screenshotOption("screenshot", "Save a screenshot after rendering.", "path");
  QCommandLineOption quitOption("quit-after-ms", "Quit after the provided delay.", "ms", "0");
  parser.addOption(dbOption);
  parser.addOption(smokeOption);
  parser.addOption(screenshotOption);
  parser.addOption(quitOption);
  parser.process(app);

  app.setStyle("Fusion");
  app.setStyleSheet(supacodeStyleSheet());

  SupacodeWindow window(parser.value(dbOption));
  window.show();

  const QString screenshotPath = parser.value(screenshotOption);
  if (!screenshotPath.isEmpty()) {
    QTimer::singleShot(700, &window, [&window, screenshotPath] { window.saveScreenshot(screenshotPath); });
  }
  bool ok = false;
  const int quitAfter = parser.value(quitOption).toInt(&ok);
  if (parser.isSet(smokeOption) || (ok && quitAfter > 0)) {
    QTimer::singleShot(ok && quitAfter > 0 ? quitAfter : 1200, &app, &QCoreApplication::quit);
  }

  return app.exec();
}
