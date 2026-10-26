# Unassigned home

- button "选择工作区":
  - img
  - text: 选择工作区
  - img

# Installed Skill marketplace

- main "技能广场":
  - button "返回对话":
    - img
    - text: 返回对话
  - heading "技能广场" [level=1]
  - paragraph: 发现适合漫剧创作的技能，让重复步骤自动完成。
  - button "已安装技能"
  - img
  - textbox:
    - /placeholder: 搜索技能名称、用途或触发词
  - button "全部"
  - button "剧本创作"
  - article:
    - button "爽文短剧剧本创作 提供从创意构思到分集剧本的创作支持。":
      - strong: 爽文短剧剧本创作
      - text: 提供从创意构思到分集剧本的创作支持。
    - text: 剧本创作 已安装
    - button "使用技能"

# Default project location in General settings

- group "默认项目路径":
  - text: 默认项目路径 {{cwd}}/automatic-projects
  - paragraph: 仅影响新项目，已有项目不会移动
  - button "更改"

# Lost response, retained draft

- alert: 项目创建未完成，草稿已保留。可以重试或选择已有项目。
- button "选择工作区":
  - img
  - text: 选择工作区
  - img

# Existing Session draft after Skill use

- button "访问模式，当前：工作区内修改": 工作区内修改
- group "待发送图片":
  - button "next-reference.png":
    - img "next-reference.png"
  - button "移除图片 next-reference.png":
    - img
- textbox "发消息或做任务… / 调用指令 @ 文件或对话":
  - paragraph: 已有会话的下一条草稿 原有script引用 原有drama引用 原有assets引用 爽文短剧剧本创作
- button "指令":
  - img
- button "选择模型，当前 DeepSeek-V4-Flash":
  - text: DeepSeek-V4-Flash
  - img
- button "上下文已用 0%"
- button "发送消息"
