function validateForm(schema, content) {
  if (!schema || schema.type !== 'object' || !content || typeof content !== 'object' || Array.isArray(content)) throw Error('表单内容无效。');
  for (const key of schema.required || []) if (!(key in content)) throw Error(`请填写 ${key}。`);
  for (const [key, value] of Object.entries(content)) {
    const rule = schema.properties?.[key];
    if (!rule) throw Error('表单包含未知字段。');
    if (rule.type === 'string') {
      if (typeof value !== 'string' || value.length > (rule.maxLength ?? 10000) || value.length < (rule.minLength ?? 0)) throw Error(`${key} 长度无效。`);
    } else if (['number', 'integer'].includes(rule.type)) {
      if (!Number.isFinite(value) || (rule.type === 'integer' && !Number.isInteger(value)) || value < (rule.minimum ?? -Infinity) || value > (rule.maximum ?? Infinity)) throw Error(`${key} 数值无效。`);
    } else if (rule.type === 'boolean') { if (typeof value !== 'boolean') throw Error(`${key} 必须是布尔值。`); }
    else if (rule.type === 'array') {
      const choices = rule.items?.enum || rule.items?.anyOf?.map(item => item.const);
      if (!Array.isArray(value) || !choices || value.some(item => !choices.includes(item)) || value.length < (rule.minItems ?? 0) || value.length > (rule.maxItems ?? 1000)) throw Error(`${key} 选项无效。`);
    } else throw Error('不支持此表单字段类型，请取消授权。');
    const choices = rule.enum || rule.oneOf?.map(item => item.const);
    if (choices && !choices.includes(value)) throw Error(`${key} 选项无效。`);
  }
  return content;
}
module.exports = { validateForm };
