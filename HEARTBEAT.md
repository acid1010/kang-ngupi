# Check system health periodically
# Add tasks below when you want the agent to check something.

- Check backend health: curl -s https://ngupingupi.me/health and report if db != "ok" or memoryMB > 400
- Check PM2 processes: pm2 list — report if any process is stopped or restart count increased significantly
