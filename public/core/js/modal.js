// 弹窗容器板块
import { $ } from './dom.js';

let currentModalConfirm = null;

export function openModal({ title = '操作确认', lead = '这是可替换的弹窗容器，后续智能体可在此挂载真实业务表单。', body = '当前为前端演示交互，不会更改考勤记录或连接任何学校系统。', confirmText = '知道了', onConfirm = null } = {}) {
  $('#modalTitle').textContent = title;
  $('#modalLead').textContent = lead;
  $('#modalBody').textContent = body;
  $('#modalConfirm').textContent = confirmText;
  $('#modalBackdrop').classList.add('open');
  currentModalConfirm = typeof onConfirm === 'function' ? onConfirm : null;
}

export function closeModal() {
  $('#modalBackdrop').classList.remove('open');
  currentModalConfirm = null;
}

export function bindModalControls() {
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalConfirm').addEventListener('click', () => {
    const callback = currentModalConfirm;
    closeModal();
    if (callback) callback();
  });
  $('#modalBackdrop').addEventListener('click', (event) => {
    if (event.target === $('#modalBackdrop')) closeModal();
  });
}
