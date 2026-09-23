"""测试环境隔离:禁用 LangSmith 追踪。

项目 .env 中 LANGSMITH_TRACING=true 会让 agent.py 的 load_dotenv() 把追踪
带进测试进程:每次模型调用都向 api.smith.langchain.com 上报(测试环境不可达),
导致模型节点卡死、内存无限膨胀,最终 OOM 崩掉整个 WSL VM。

load_dotenv() 默认不覆盖已存在的环境变量,因此必须在它运行之前设为 false;
pytest 先加载 conftest.py,再导入测试模块,顺序满足要求。
"""

import os

os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"
