(function() {
  console.log('[TEST] Starting minimal editor...');

  // Create root
  var root = document.createElement('div');
  root.id = 'rb-editor-root';
  root.style.cssText = 'position:fixed;top:0;left:0;right:0;height:40px;background:red;z-index:2147483647;display:flex;align-items:center;justify-content:center;color:white;font:bold 16px sans-serif;pointer-events:auto;';
  root.textContent = 'REPIX EDITOR IS WORKING';
  document.body.appendChild(root);

  console.log('[TEST] Root appended, visible:', getComputedStyle(root).display);
})();
