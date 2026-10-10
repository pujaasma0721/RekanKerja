#!/bin/bash
# usage: explore.sh <PageName> <shotname(optional)>
agent-browser --session oran open "https://demo.oranhr.com/$1.jsp" >/dev/null 2>&1
agent-browser --session oran wait 5000 >/dev/null 2>&1
echo "===== $1 ====="
agent-browser --session oran eval "$(cat /home/z/my-project/.tmp-research/extract2.js)" 2>&1
echo ""
if [ -n "$2" ]; then agent-browser --session oran screenshot "/home/z/my-project/.tmp-research/$2.png" 2>&1 | tail -1; fi
