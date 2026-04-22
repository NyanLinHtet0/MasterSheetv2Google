import os
import subprocess
import sys
import time

VALID_DB_TARGETS = {"local", "google"}


def parse_db_target(argv):
    if len(argv) < 2:
        return "google"

    target = argv[1].strip().lower()
    if target not in VALID_DB_TARGETS:
        print("Usage: python start_app.py [local|google]")
        print(f"Received invalid database target: {argv[1]}")
        sys.exit(1)

    return target


def run_servers(db_target):
    # Get the directory where this script is located
    root_dir = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.join(root_dir, "backend")
    frontend_dir = os.path.join(root_dir, "frontend")

    # Ensure the directories exist before trying to run commands
    if not os.path.exists(backend_dir) or not os.path.exists(frontend_dir):
        print("Error: Could not find 'backend' or 'frontend' folders.")
        print("Make sure this script is in the root directory alongside them.")
        sys.exit(1)

    backend_env = os.environ.copy()
    backend_env["DB_TARGET"] = db_target

    print(f"🗄️ Database target: {db_target}")
    print("🚀 Starting Backend Server...")
    backend_process = subprocess.Popen(
        "npm start",
        cwd=backend_dir,
        shell=True,
        env=backend_env,
    )

    print("🚀 Starting Frontend Server...")
    frontend_process = subprocess.Popen(
        "npm run dev",
        cwd=frontend_dir,
        shell=True,
    )

    print("\n==================================================")
    print("✅ Both servers are booting up!")
    print("🛑 Press Ctrl+C in this terminal to stop both servers.")
    print("==================================================\n")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\nShutting down servers...")
        backend_process.terminate()
        frontend_process.terminate()
        print("Servers stopped successfully. Goodbye!")


if __name__ == "__main__":
    selected_db_target = parse_db_target(sys.argv)
    run_servers(selected_db_target)
