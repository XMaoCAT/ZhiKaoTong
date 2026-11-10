/**
 * 全局共享常量（单源，踩坑 #05 禁令：字典严禁多处副本）
 * 2026-10-23 P2 建立：TEACHERS 从 src/api/academic.js 内嵌常量外移至此。
 * 2026-10-24 账号动态化：TEACHERS 常量已退役——教师账号迁移至 SQLite teachers 表
 * （academic.js 建表 + listTeacherNames() 单源查询；支持教务管理添加教师/系统管理生成模拟数据）。
 * 严禁再以任何硬编码数组维护教师清单。
 */

/** 工作流申请方（class-* 三类提交权限，开发计划 §5.1；消费方 workflow.js） */
export const REQUEST_ROLES = ['教务处'];

/** 工作流审批方（class-* 三类审批权限，开发计划 §5.1；消费方 workflow.js） */
export const REVIEW_ROLES = ['学生处', 'IT管理员'];
