/**
 * 文件管理器增强插件 - 支持无后缀名文件处理
 * FileManager Enhancer Plugin - Support for files without extensions
 * 
 */

(function(window, document) {
    'use strict';

    // 文件类型检测器
    const FileTypeDetector = {
        // 检测无后缀名文件
        isNoExtensionFile: function(filename) {
            if (!filename) return false;
            const lowerName = filename.toLowerCase();
            // 不包含点号，或者点号在最后
            return !lowerName.includes('.') || lowerName.endsWith('.');
        },

        // 检测可能的文件类型（基于文件名模式）
        detectFileType: function(filename) {
            if (!filename) return { type: 'unknown', confidence: 0 };
            
            const name = filename.toLowerCase();
            
            // 常见的无后缀名文件类型检测
            const patterns = [
                { type: 'makefile', patterns: ['makefile', 'makefile.unix', 'makefile.win'], confidence: 90 },
            ];

            for (const pattern of patterns) {
                for (const p of pattern.patterns) {
                    if (name.includes(p)) {
                        return { type: pattern.type, confidence: pattern.confidence };
                    }
                }
            }

            return { type: 'text', confidence: 50 }; // 默认当作文本文件处理
        },

        // 获取文件图标
        getFileIcon: function(fileType) {
            const iconMap = {
                'makefile': '📋'
            };
            return iconMap[fileType] || iconMap['unknown'];
        }
    };

    // 文件预览增强器
    const FilePreviewEnhancer = {
        // 初始化增强器
        init: function() {
            this.hookIntoFileManager();
            this.addStyles();
            this.addGlobalModalInterceptor(); // 添加全局模态框拦截器
            this.addContextMenuListener(); // 添加右击菜单监听器
        },

        // 钩入文件管理器
        hookIntoFileManager: function() {
            const self = this;
            
            // 监听表格行点击事件 (适配 trim-ui__table--tr 结构)
            // 使用capture和更高优先级确保先执行
            document.addEventListener('click', function(e) {
                const fileRow = e.target.closest('tr.trim-os__file-manager--item');
                if (fileRow && fileRow.hasAttribute('data-path')) {
                    // 检查是否为无后缀名文件
                    const filename = self.getFileName(fileRow);
                    if (FileTypeDetector.isNoExtensionFile(filename) && !self.isFolder(fileRow)) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation(); // 阻止其他监听器
                        self.handleFileClick(fileRow, e);
                    }
                }
            }, true); // true表示在捕获阶段执行

            // 监听表格行双击事件
            document.addEventListener('dblclick', function(e) {
                const fileRow = e.target.closest('tr.trim-os__file-manager--item');
                if (fileRow && fileRow.hasAttribute('data-path')) {
                    const filename = self.getFileName(fileRow);
                    if (FileTypeDetector.isNoExtensionFile(filename) && !self.isFolder(fileRow)) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation(); // 阻止其他监听器
                        self.handleFileDoubleClick(fileRow, e);
                    }
                }
            }, true);
        },

        // 处理文件点击
        handleFileClick: function(fileElement, event) {
            // 检查是否为文件夹
            if (this.isFolder(fileElement)) {
                return; // 跳过文件夹
            }
            
            const filename = this.getFileName(fileElement);
            if (FileTypeDetector.isNoExtensionFile(filename)) {
                // 只显示文件信息，不触发原系统的打开逻辑
                this.showFileInfo(fileElement, filename);
                
                // 确保不会触发原系统的其他事件
                setTimeout(() => {
                    // 延迟执行，避免与原系统冲突
                    const modal = document.querySelector('.file-preview-modal');
                    if (!modal) {
                        // 如果没有显示我们的模态框，说明被阻止了
                        // 这里可以添加额外的处理逻辑
                    }
                }, 10);
            }
        },

        // 处理文件双击
        handleFileDoubleClick: function(fileElement, event) {
            // 检查是否为文件夹
            if (this.isFolder(fileElement)) {
                return; // 让文件夹使用默认的打开行为
            }
            
            const filename = this.getFileName(fileElement);
            
            if (FileTypeDetector.isNoExtensionFile(filename)) {
                // 双击无后缀名文件时，将其当作txt文件打开
                this.simulateTxtFileOpen(fileElement, filename, event);
            }
        },

        // 检查是否为文件夹
        isFolder: function(fileElement) {
            // 优先方法：直接检查文件扩展名
            const filename = this.getFileName(fileElement);
            const fullPath = fileElement.getAttribute('data-path');
            
            // 如果文件名包含点号，通常是文件
            if (filename.includes('.')) {
                return false;
            }
            
            // 最可靠的方法1：检查CSS类名
            if (fileElement.classList.contains('trim-os__file-manager--dir')) {
                return true;
            }
            
            // 方法2：检查图标路径
            const iconElement = fileElement.querySelector('img');
            if (iconElement) {
                const src = iconElement.src.toLowerCase();
                // 如果图标路径包含"folder"，很可能是文件夹
                if (src.includes('folder')) {
                    return true;
                }
            }
            
            // 方法3：检查类型标识单元格
            const typeCell = fileElement.querySelector('td:nth-child(3) .text-text-0');
            if (typeCell) {
                const typeText = typeCell.getAttribute('title') || typeCell.textContent.trim();
                if (typeText === '文件夹' || typeText.includes('folder') || typeText.includes('directory')) {
                    return true;
                }
                // 如果显示"无后缀名文件"，则明确不是文件夹
                if (typeText === '无后缀名文件') {
                    return false;
                }
            }
            
            // 方法4：通过class判断（备用）
            if (fileElement.classList.contains('folder') || 
                fileElement.classList.contains('directory') ||
                fileElement.classList.contains('trim-folder')) {
                return true;
            }
            
            // 方法5：通过data属性判断
            const dataType = fileElement.getAttribute('data-type');
            if (dataType && (dataType.includes('folder') || dataType.includes('directory'))) {
                return true;
            }
            
            // 排除明显是文件的情况
            const commonFileNames = ['manifest', 'readme', 'license', 'changelog', 'makefile', 'dockerfile'];
            if (commonFileNames.includes(filename.toLowerCase())) {
                return false;
            }
            
            // 如果前面都没有明确判断，且没有扩展名，默认为文件（保守策略）
            return false;
        },
        
        // 获取文件名
        getFileName: function(fileElement) {
            // 从 data-path 属性获取完整路径
            const fullPath = fileElement.getAttribute('data-path');
            if (fullPath) {
                // 提取文件名（路径的最后一部分）
                return fullPath.split('/').pop();
            }
            
            // 备用方案：尝试从文件名容器获取
            const fileNameElement = fileElement.querySelector('.text-text-0[title]');
            if (fileNameElement) {
                return fileNameElement.getAttribute('title') || fileNameElement.textContent.trim();
            }
            
            return fileElement.textContent.trim();
        },


        // 打开无后缀名文件
        openNoExtensionFile: function(fileElement, filename) {
            const fileType = FileTypeDetector.detectFileType(filename);
            
            // 创建预览对话框
            this.showFilePreviewDialog(fileElement, filename, fileType);
        },

        // 显示文件预览对话框
        showFilePreviewDialog: function(fileElement, filename, fileType) {
            const modal = document.createElement('div');
            modal.className = 'file-preview-modal';
            modal.innerHTML = `
                <div class="modal-overlay" onclick="this.parentElement.remove()"></div>
            `;
            
            document.body.appendChild(modal);
            
            // 绑定全局方法
            window.FileManagerEnhancer = this;
        },

        // 获取建议处理方式
        getSuggestedAction: function(fileType) {
            const suggestions = {
                'makefile': '使用文本编辑器查看'
            };
            return suggestions[fileType] || suggestions['unknown'];
        },

        // 添加全局模态框拦截器
        addGlobalModalInterceptor: function() {
            const self = this;
            
            // 监听DOM变化，检测新出现的模态框
            const observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === 1) { // Element node
                            // 检查是否是我们的模态框
                            if (node.classList && node.classList.contains('semi-modal-content')) {
                                // 检查内容是否为不支持格式的弹窗
                                const content = node.querySelector('.semi-modal-confirm-content');
                                if (content && content.textContent.includes('暂不支持打开当前格式的文件')) {
                                    // 关闭这个弹窗
                                    node.remove();
                                }
                            }
                        }
                    });
                });
            });
            
            // 开始观察
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            
            // 保存观察器引用以便后续清理
            this.modalObserver = observer;
        },
        
        // 添加样式
        addStyles: function() {
            if (document.getElementById('file-manager-enhancer-styles')) return;
            
            const style = document.createElement('style');
            style.id = 'file-manager-enhancer-styles';
            
            document.head.appendChild(style);
        }
    };

    // 全局方法绑定
    FilePreviewEnhancer.openAsText = function(filename) {
        const previewArea = document.getElementById('file-preview-area');
        if (previewArea) {
            previewArea.innerHTML = `
                <h4>📄 文本文件内容预览</h4>
                <p><em>这将使用内置文本查看器打开文件</em></p>
                <p><strong>文件:</strong> ${filename}</p>
                <p>实际实现中，这里会显示文件内容或调用原系统的文本查看器。</p>
            `;
        }
    };
    
    // 使用原系统的txt文件预览逻辑
    FilePreviewEnhancer.simulateTxtFileOpen = function(fileElement, filename, event) {
        // 阻止原系统的无后缀名文件处理
        if (event) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        }
        
        const fullPath = fileElement.getAttribute('data-path');
            
        // 获取基础服务器地址
        const baseUrl = this.getBaseServerUrl();
        const apiPath = '/cgi/ThirdParty/all.editor/index.cgi';
        
        // 构建预览URL - 新的简化格式，不需要文件类型判断
        const previewUrl = `${baseUrl}${apiPath}?path=/${encodeURIComponent(fullPath)}`;
        
        // 使用原系统的预览方式
        this.openOriginalTextPreview(previewUrl, filename, fullPath);
    };
    
    // 获取基础服务器地址
    FilePreviewEnhancer.getBaseServerUrl = function() {
        // 从当前页面URL中提取基础服务器地址
        const currentUrl = window.location.href;
        const url = new URL(currentUrl);
        return `${url.protocol}//${url.host}`;
    };

    // 获取当前目录
    FilePreviewEnhancer.getCurrentDirectory = function() {
        // 查找页面上的第一个文件或文件夹行
        const firstFileRow = document.querySelector('tr.trim-os__file-manager--item[data-path]');
        if (firstFileRow) {
            const fullPath = firstFileRow.getAttribute('data-path');
            return this.getDirname(fullPath);
        }

        // 备用方法：从URL获取
        const hash = window.location.hash;
        if (hash && hash.startsWith('#/')) {
            return decodeURIComponent(hash.substring(1)); // 去掉#并解码
        }
        const searchParams = new URLSearchParams(window.location.search);
        const pathParam = searchParams.get('path');
        if (pathParam) {
            return pathParam;
        }
        // 默认返回根目录
        return '/';
    };

    // 获取路径的目录部分
    FilePreviewEnhancer.getDirname = function(path) {
        if (!path) return '/';
        // 移除末尾的斜杠（如果是目录）
        if (path.endsWith('/')) {
            path = path.slice(0, -1);
        }
        const lastSlash = path.lastIndexOf('/');
        if (lastSlash > 0) {
            return path.substring(0, lastSlash + 1);
        }
        return '/';
    };
    
    // 使用原系统的文本文件预览方式 - 专业应用窗口样式
    FilePreviewEnhancer.openOriginalTextPreview = function(url, filename, fullPath) {
        // 使用专业的应用窗口样式，类似真正的桌面应用
        const windowElement = document.createElement('div');
        windowElement.className = 'w-[1100px] h-[640px] absolute flex flex-col overflow-hidden shadow-[var(--semi-shadow-app)] trim-ui__app-layout--window is-resizable';
        windowElement.style.cssText = `
            width: 1100px;
            height: 665px;
            border-radius: 16px;
            z-index: 10010;
            left: 181px;
            top: 128.5px;
            position: fixed;
            background: white;
        `;
        
        windowElement.innerHTML = `
            <div class="trim-ui__app-layout--background absolute inset-0 z-[-1] overflow-hidden bg-[var(--semi-color-app)]"></div>
            
            <div class="trim-ui__app-layout--header box-border flex h-[44px] w-full shrink-0 cursor-move justify-between bg-app-header">
                <div class="trim-ui__app-layout--header-title m-0 box-border flex w-full flex-1 items-center overflow-hidden pl-4 pr-9 text-[14px] font-[400]">
                    <div class="h-loose flex items-center w-full">
                        <img src="/app-center-static/serviceicon/all.editor/ui/images/icon_{0}.png?size=256" alt="万能编辑器" class="size-loose mr-2 block select-none pointer-events-none">
                        <span class="max-w-full truncate leading-5 font-[600] text-[var(--semi-color-text-0)]">万能编辑器</span>
                    </div>
                </div>
                <div class="flex items-center">
                    <div class="flex h-full w-base shrink-0 cursor-pointer items-center px-[15px] text-[var(--semi-color-text-0)] hover:bg-[var(--semi-color-fill-0)] active:bg-[var(--semi-color-fill-0)] app-layout-header-minimize">
                        <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M21 11a1 1 0 110 2H3a1 1 0 110-2h18z"></path>
                        </svg>
                    </div>
                    <div class="flex h-full w-base shrink-0 cursor-pointer items-center px-[15px] text-[var(--semi-color-text-0)] hover:bg-[var(--semi-color-fill-0)] active:bg-[var(--semi-color-fill-0)] app-layout-header-maximize">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M3.2591 2.66663H12.7406C12.8977 2.66663 13.0485 2.72906 13.1596 2.84019C13.2707 2.95132 13.3332 3.10205 13.3332 3.25922V12.7407C13.3332 12.8979 13.2707 13.0486 13.1596 13.1597C13.0485 13.2709 12.8977 13.3333 12.7406 13.3333H3.2591C3.10193 13.3333 2.9512 13.2709 2.84007 13.1597C2.72894 13.0486 2.6665 12.8979 2.6665 12.7407V3.25922C2.6665 3.10205 2.72894 2.95132 2.84007 2.84019C2.9512 2.72906 3.10193 2.66663 3.2591 2.66663ZM3.85169 3.85181V12.1481H12.148V3.85181H3.85169Z" fill="currentColor"></path>
                        </svg>
                    </div>
                    <div class="flex h-full w-base shrink-0 cursor-pointer items-center px-[15px] text-[var(--semi-color-text-0)] hover:bg-[var(--semi-color-danger)] active:bg-[var(--semi-color-danger)] app-layout-header-close hover:!text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor">
                            <path fill-rule="evenodd" clip-rule="evenodd" d="M5.293 5.293a1 1 0 011.414 0L12 10.586l5.293-5.293a1 1 0 111.414 1.414L13.414 12l5.293 5.293a1 1 0 01-1.414 1.414L12 13.414l-5.293 5.293a1 1 0 01-1.414-1.414L10.586 12 5.293 6.707a1 1 0 010-1.414z"></path>
                        </svg>
                    </div>
                </div>
            </div>
            
            <div class="relative h-[calc(100%-44px)]">
                <div class="relative size-full">
                    <iframe src="${url}" style="width: 100%; height: 100%; border: none;" 
                            onerror="this.parentElement.innerHTML='<div style=\"padding: 20px; text-align: center; color: #666; height: 100%; display: flex; align-items: center; justify-content: center;\">文件预览加载失败，请检查文件是否存在或权限设置。</div>'">
                    </iframe>
                </div>
            </div>
            
            <!-- 可调整大小的句柄 -->
            <div class="resizable-handler t"></div>
            <div class="resizable-handler rt"></div>
            <div class="resizable-handler r"></div>
            <div class="resizable-handler rb"></div>
            <div class="resizable-handler b"></div>
            <div class="resizable-handler lb"></div>
            <div class="resizable-handler l"></div>
            <div class="resizable-handler lt"></div>
        `;
        
        // 添加样式
        const style = document.createElement('style');
        style.textContent = `
            .trim-ui__app-layout--window {
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            }

            .app-layout-header-close:hover {
                background: #dc2626 !important;
                color: white !important;
            }

            /* 可调整大小句柄样式 */
            .resizable-handler {
                position: absolute;
                background: transparent;
                z-index: 10;
            }
            
            .resizable-handler.t {
                top: -3px;
                left: 0;
                right: 0;
                height: 6px;
                cursor: n-resize;
            }
            
            .resizable-handler.rt {
                top: -3px;
                right: -3px;
                width: 6px;
                height: 6px;
                cursor: ne-resize;
            }
            
            .resizable-handler.r {
                top: 0;
                right: -3px;
                width: 6px;
                bottom: 0;
                cursor: e-resize;
            }
            
            .resizable-handler.rb {
                bottom: -3px;
                right: -3px;
                width: 6px;
                height: 6px;
                cursor: se-resize;
            }
            
            .resizable-handler.b {
                bottom: -3px;
                left: 0;
                right: 0;
                height: 6px;
                cursor: s-resize;
            }
            
            .resizable-handler.lb {
                bottom: -3px;
                left: -3px;
                width: 6px;
                height: 6px;
                cursor: sw-resize;
            }
            
            .resizable-handler.l {
                top: 0;
                left: -3px;
                width: 6px;
                bottom: 0;
                cursor: w-resize;
            }
            
            .resizable-handler.lt {
                top: -3px;
                left: -3px;
                width: 6px;
                height: 6px;
                cursor: nw-resize;
            }
        `;
        
        document.head.appendChild(style);
        
        // 查找桌面元素，将窗口添加到桌面元素内
        const desktopElement = document.querySelector('.desktop');
        if (desktopElement) {
            desktopElement.appendChild(windowElement);
        } else {
            // 如果找不到桌面元素，回退到添加到 body
            document.body.appendChild(windowElement);
        }
        
        // 添加窗口控制功能
        this.addWindowControls(windowElement);
        
        // 窗口点击事件处理函数
        function handleWindowClick() {
            // 查找所有桌面窗口（包括万能编辑器和其他系统窗口）
            const desktopWindows = document.querySelectorAll('.desktop .trim-ui__app-layout--window, .desktop [class*="window"]');
            
            // 找到当前最大的z-index值（与系统窗口保持一致，从10010开始）
            let maxZIndex = 10010;
            desktopWindows.forEach(win => {
                const zIndex = parseInt(win.style.zIndex) || 10010;
                if (zIndex > maxZIndex) {
                    maxZIndex = zIndex;
                }
            });
            
            // 将当前窗口的z-index设置为比最大的大1
            windowElement.style.zIndex = maxZIndex + 1;
        }
        
        // 添加点击事件，实现窗口置顶（监听整个窗口元素，包括iframe内部）
        windowElement.addEventListener('mousedown', handleWindowClick, true);
        
        // 监听iframe的点击事件
        const iframe = windowElement.querySelector('iframe');
        if (iframe) {
            // 尝试在iframe加载完成后添加点击事件
            iframe.onload = function() {
                // 第一次打开时，设置z-index为最大值，确保置顶
                handleWindowClick();
                
                try {
                    // 只有当iframe和主页面同源时才能访问其内容
                    const iframeDocument = iframe.contentDocument || iframe.contentWindow.document;
                    iframeDocument.addEventListener('mousedown', handleWindowClick);
                } catch (e) {
                    // 跨域iframe无法访问，忽略错误
                }
            };
        } else {
            // 如果没有iframe，直接设置z-index为最大值
            handleWindowClick();
        }
        
        // 监听桌面元素中的点击事件，当其他窗口被点击时，确保万能编辑器窗口的z-index正确
        if (desktopElement) {
            desktopElement.addEventListener('mousedown', function(e) {
                // 检查点击的是否是其他窗口
                const clickedWindow = e.target.closest('.trim-ui__app-layout--window, .desktop-window, [class*="window"]');
                if (clickedWindow && clickedWindow !== windowElement) {
                    // 其他窗口被点击，将万能编辑器窗口的z-index设置为两位数
                    // 找到当前最大的两位数z-index
                    let maxTwoDigitZIndex = 10;
                    const desktopWindows = document.querySelectorAll('.desktop .trim-ui__app-layout--window, .desktop [class*="window"]');
                    desktopWindows.forEach(win => {
                        const zIndex = parseInt(win.style.zIndex) || 10;
                        if (zIndex >= 10 && zIndex < 100 && zIndex > maxTwoDigitZIndex) {
                            maxTwoDigitZIndex = zIndex;
                        }
                    });
                    
                    // 将万能编辑器窗口的z-index设置为比最大的两位数大1
                    windowElement.style.zIndex = maxTwoDigitZIndex + 1;
                }
            });
        }
        
        // 自动清理样式
        windowElement.addEventListener('remove', () => {
            if (document.head.contains(style)) {
                document.head.removeChild(style);
            }
        });
    };
    
    // 添加窗口控制功能
    FilePreviewEnhancer.addWindowControls = function(windowElement) {
        // 关闭按钮功能
        const closeBtn = windowElement.querySelector('.app-layout-header-close');
        if (closeBtn) {
            // 鼠标点击
            closeBtn.addEventListener('click', () => {
                windowElement.remove();
            });
            // 触摸点击
            closeBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // 添加触摸反馈
                closeBtn.style.background = '#dc2626';
                closeBtn.style.color = 'white';
                
                // 延迟关闭，让用户看到反馈
                setTimeout(() => {
                    windowElement.remove();
                }, 100);
            });
        }
        
        // 最小化按钮功能
        const minimizeBtn = windowElement.querySelector('.app-layout-header-minimize');
        if (minimizeBtn) {
            // 保存原始窗口位置和尺寸
            let originalRect = {
                left: windowElement.style.left,
                top: windowElement.style.top,
                width: windowElement.style.width,
                height: windowElement.style.height
            };
            
            // 鼠标点击
            minimizeBtn.addEventListener('click', () => {
                if (windowElement.style.display === 'none') {
                    // 恢复显示
                    windowElement.style.display = '';
                    windowElement.style.opacity = '1';
                    windowElement.style.transform = 'scale(1)';
                } else {
                    // 保存当前尺寸位置
                    originalRect = {
                        left: windowElement.style.left,
                        top: windowElement.style.top,
                        width: windowElement.style.width,
                        height: windowElement.style.height
                    };
                    // 最小化隐藏
                    windowElement.style.transform = 'scale(0.8)';
                    windowElement.style.opacity = '0';
                    setTimeout(() => {
                        windowElement.style.display = 'none';
                    }, 200);
                }
                
                // 更新任务栏图标状态
                updateTaskbarIconState(windowElement, windowElement.style.display !== 'none');
            });
            
            // 触摸点击
            minimizeBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // 添加触摸反馈
                minimizeBtn.style.background = 'var(--semi-color-fill-0)';
                
                // 延迟执行，让用户看到反馈
                setTimeout(() => {
                    if (windowElement.style.display === 'none') {
                        // 恢复显示
                        windowElement.style.display = '';
                        windowElement.style.opacity = '1';
                        windowElement.style.transform = 'scale(1)';
                    } else {
                        // 保存当前尺寸位置
                        originalRect = {
                            left: windowElement.style.left,
                            top: windowElement.style.top,
                            width: windowElement.style.width,
                            height: windowElement.style.height
                        };
                        // 最小化隐藏
                        windowElement.style.transform = 'scale(0.8)';
                        windowElement.style.opacity = '0';
                        setTimeout(() => {
                            windowElement.style.display = 'none';
                        }, 200);
                    }
                    
                    // 更新任务栏图标状态
                    updateTaskbarIconState(windowElement, windowElement.style.display !== 'none');
                }, 100);
            });
        }
        
        // 查找任务栏并添加图标
        const taskbarContainer = document.querySelector('.scrollbar-hidden.absolute.inset-0.flex.flex-col.items-end.justify-start.gap-2');
        if (taskbarContainer) {
            // 创建任务栏图标
            const taskbarIcon = document.createElement('div');
            taskbarIcon.className = 'flex h-10 w-[47px] items-center justify-center gap-x-2 border-0 !border-l-[3px] border-solid border-transparent hover:bg-white-10 taskbar-icon';
            taskbarIcon.dataset.windowId = 'window-' + Date.now();
            taskbarIcon.innerHTML = `
                <div class="flex h-9 shrink-0 flex-row items-center px-[3px] py-super-tight" tabindex="0" aria-describedby="qsueowf" data-popupid="qsueowf">
                    <div class="box-border size-[80px] p-[15%] !h-[36px] !w-[36px]">
                        <div class="semi-image size-full">
                            <img src="/app-center-static/serviceicon/all.editor/ui/images/icon_{0}.png?size=256" data-src="/app-center-static/serviceicon/all.editor/ui/images/icon_{0}.png?size=256" alt="万能编辑器" class="semi-image-img w-full h-full !rounded-[10%]" style="user-select: none; pointer-events: none;">
                        </div>
                    </div>
                </div>
            `;
            
            // 插入到设置图标之前
            const settingIcon = taskbarContainer.querySelector('[data-popupid="1bo41o2"]');
            if (settingIcon && settingIcon.parentElement) {
                settingIcon.parentElement.parentElement.parentElement.before(taskbarIcon);
            } else {
                taskbarContainer.appendChild(taskbarIcon);
            }
            
            // 点击任务栏图标显示/隐藏窗口
            taskbarIcon.addEventListener('click', () => {
                if (windowElement.style.display === 'none') {
                    // 恢复显示
                    windowElement.style.display = '';
                    windowElement.style.opacity = '1';
                    windowElement.style.transform = 'scale(1)';
                    updateTaskbarIconState(windowElement, true);
                } else {
                    // 隐藏窗口
                    originalRect = {
                        left: windowElement.style.left,
                        top: windowElement.style.top,
                        width: windowElement.style.width,
                        height: windowElement.style.height
                    };
                    windowElement.style.transform = 'scale(0.8)';
                    windowElement.style.opacity = '0';
                    setTimeout(() => {
                        windowElement.style.display = 'none';
                    }, 200);
                    updateTaskbarIconState(windowElement, false);
                }
            });
            
            // 存储任务栏图标引用
            windowElement._taskbarIcon = taskbarIcon;
        }
        
        // 更新任务栏图标状态函数
        function updateTaskbarIconState(win, isActive) {
            const icon = win._taskbarIcon;
            if (icon) {
                if (isActive) {
                    icon.classList.add('bg-white-10', '!border-focus-border');
                } else {
                    icon.classList.remove('bg-white-10', '!border-focus-border');
                }
            }
        }
        
        // 最大化按钮功能
        const maximizeBtn = windowElement.querySelector('.app-layout-header-maximize');
        if (maximizeBtn) {
            let isMaximized = false;
            let originalRect = {};
            
            // 鼠标点击
            maximizeBtn.addEventListener('click', () => {
                if (!isMaximized) {
                    // 保存原始尺寸和位置
                    originalRect = {
                        left: windowElement.style.left,
                        top: windowElement.style.top,
                        width: windowElement.style.width,
                        height: windowElement.style.height
                    };
                    
                    // 最大化
                    windowElement.style.left = '0px';
                    windowElement.style.top = '0px';
                    windowElement.style.width = '100vw';
                    windowElement.style.height = '100vh';
                    windowElement.style.borderRadius = '0px';
                    
                    isMaximized = true;
                } else {
                    // 恢复原始尺寸
                    windowElement.style.left = originalRect.left;
                    windowElement.style.top = originalRect.top;
                    windowElement.style.width = originalRect.width;
                    windowElement.style.height = originalRect.height;
                    windowElement.style.borderRadius = '16px';
                    
                    isMaximized = false;
                }
            });
            // 触摸点击
            maximizeBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // 添加触摸反馈
                maximizeBtn.style.background = 'var(--semi-color-fill-0)';
                
                // 延迟执行，让用户看到反馈
                setTimeout(() => {
                    if (!isMaximized) {
                        // 保存原始尺寸和位置
                        originalRect = {
                            left: windowElement.style.left,
                            top: windowElement.style.top,
                            width: windowElement.style.width,
                            height: windowElement.style.height
                        };
                        
                        // 最大化
                        windowElement.style.left = '0px';
                        windowElement.style.top = '0px';
                        windowElement.style.width = '100vw';
                        windowElement.style.height = '100vh';
                        windowElement.style.borderRadius = '0px';
                        
                        isMaximized = true;
                    } else {
                        // 恢复原始尺寸
                        windowElement.style.left = originalRect.left;
                        windowElement.style.top = originalRect.top;
                        windowElement.style.width = originalRect.width;
                        windowElement.style.height = originalRect.height;
                        windowElement.style.borderRadius = '16px';
                        
                        isMaximized = false;
                    }
                }, 100);
            });
        }
        
        // ESC键关闭
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                windowElement.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        
        // 窗口拖拽功能
        const header = windowElement.querySelector('.trim-ui__app-layout--header');
        if (header) {
            let isDragging = false;
            let startX, startY, startLeft, startTop;
            
            // 鼠标事件
            header.addEventListener('mousedown', (e) => {
                // 阻止事件冒泡，避免触发其他元素的事件
                e.stopPropagation();
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                startLeft = parseInt(windowElement.style.left) || 0;
                startTop = parseInt(windowElement.style.top) || 0;
                
                // 使用捕获阶段来确保事件被正确捕获
                document.addEventListener('mousemove', handleMouseMove, true);
                document.addEventListener('mouseup', handleMouseUp, true);
                
                // 防止文本选择
                document.body.style.userSelect = 'none';
            });
            
            // 触摸事件支持（移动端）
            header.addEventListener('touchstart', (e) => {
                e.stopPropagation();
                isDragging = true;
                const touch = e.touches[0];
                startX = touch.clientX;
                startY = touch.clientY;
                startLeft = parseInt(windowElement.style.left) || 0;
                startTop = parseInt(windowElement.style.top) || 0;
                
                document.addEventListener('touchmove', handleTouchMove, true);
                document.addEventListener('touchend', handleTouchEnd, true);
                
                // 防止页面滚动
                e.preventDefault();
                document.body.style.userSelect = 'none';
            });
            
            const handleMouseMove = (e) => {
                if (!isDragging) return;
                
                e.preventDefault();
                e.stopPropagation();
                
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;
                
                windowElement.style.left = (startLeft + deltaX) + 'px';
                windowElement.style.top = (startTop + deltaY) + 'px';
            };
            
            const handleTouchMove = (e) => {
                if (!isDragging) return;
                
                e.preventDefault();
                e.stopPropagation();
                
                const touch = e.touches[0];
                const deltaX = touch.clientX - startX;
                const deltaY = touch.clientY - startY;
                
                windowElement.style.left = (startLeft + deltaX) + 'px';
                windowElement.style.top = (startTop + deltaY) + 'px';
            };
            
            const handleMouseUp = () => {
                isDragging = false;
                document.removeEventListener('mousemove', handleMouseMove, true);
                document.removeEventListener('mouseup', handleMouseUp, true);
                document.body.style.userSelect = '';
            };
            
            const handleTouchEnd = () => {
                isDragging = false;
                document.removeEventListener('touchmove', handleTouchMove, true);
                document.removeEventListener('touchend', handleTouchEnd, true);
                document.body.style.userSelect = '';
            };
        }
    };
    
    // 备用方案：如果API方式失败，尝试模拟原系统的txt文件处理
    FilePreviewEnhancer.simulateOriginalTxtHandling = function(fileElement, filename, event) {
        // 临时修改文件元素，添加.txt扩展名
        const originalPath = fileElement.getAttribute('data-path');
        const tempPath = originalPath + '.txt';
        
        // 快速修改并触发事件
        fileElement.setAttribute('data-path', tempPath);
        
        // 延迟触发双击事件，让原系统按txt文件处理
        setTimeout(() => {
            const dblclickEvent = new MouseEvent('dblclick', {
                bubbles: true,
                cancelable: true,
                view: window
            });
            fileElement.dispatchEvent(dblclickEvent);
            
            // 恢复原始路径
            setTimeout(() => {
                fileElement.setAttribute('data-path', originalPath);
            }, 100);
        }, 10);
    };
    
    // 打开为文本文件（保留原有方法名以兼容）
    FilePreviewEnhancer.openAsTextFile = function(fileElement, filename) {
        this.simulateTxtFileOpen(fileElement, filename, null);
    };
    


    FilePreviewEnhancer.downloadFile = function(filename) {
        alert(`正在下载文件: ${filename}\n\n实际实现中，这里会触发文件下载。`);
    };

    FilePreviewEnhancer.renameFile = function(filename) {
        const newName = prompt('请输入新的文件名（包含扩展名）:', filename);
        if (newName && newName !== filename) {
            alert(`正在重命名文件:\n从: ${filename}\n到: ${newName}\n\n实际实现中，这里会调用原系统的重命名功能。`);
        }
    };

    // 自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            FilePreviewEnhancer.init();
        });
    } else {
        FilePreviewEnhancer.init();
    }

    // 添加右击菜单监听器
    FilePreviewEnhancer.addContextMenuListener = function() {
        const self = this;
        document.addEventListener('contextmenu', function(e) {
            // 检查是否在文件管理器区域右击
            const fileManagerArea = e.target.closest('[class*="file-manager"]') || e.target.closest('table');
            if (fileManagerArea) {
                const fileRow = e.target.closest('tr.trim-os__file-manager--item');
                // 延迟处理，以便原菜单先出现
                setTimeout(() => {
                    self.addContextMenuItem(fileRow);
                }, 10);
            }
        }, true);
    };

    // 添加上下文菜单项
    FilePreviewEnhancer.addContextMenuItem = function(fileRow) {
        // 查找右击菜单
        const menu = document.querySelector('.base-Popper-root');
        if (!menu) return;

        // 检查是否已经添加了
        if (menu.querySelector('.all-editor-menu-item')) return;

        // 创建新菜单项
        const newItem = document.createElement('div');
        newItem.className = 'relative all-editor-menu-item';
        newItem.innerHTML = `<div class="" title=""><div class="my-super-tight flex items-center justify-between px-4 py-2 relative w-full text-[12px] box-border cursor-pointer whitespace-nowrap hover:bg-[var(--semi-color-fill-0)]"><span class="flex w-full max-w-[170px] overflow-hidden text-ellipsis"><span class="inline-flex w-full flex-1 items-center gap-2"><span class="truncate text-[14px] leading-xs w-full"><div class="flex w-[150px] items-center"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" class="text-[16px] mr-[8px] shrink-0"><path fill-rule="evenodd" clip-rule="evenodd" d="M10 2a8 8 0 105.292 14.000l5.36 5.36a1 1 0 001.414-1.414l-5.36-5.36A8 8 0 0010 2zm0 2a6 6 0 110 12 6 6 0 010-12z"/></svg><span>万能编辑器中打开</span></div></span></span></span></div></div></div>`;

        // 添加点击事件
        newItem.addEventListener('click', (e) => {
            // 阻止事件冒泡，避免触发系统默认行为
            e.stopPropagation();
            e.preventDefault();
            
            // 关闭右键菜单
            const menu = document.querySelector('.base-Popper-root');
            if (menu) {
                // 模拟点击菜单外部来关闭菜单
                const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: 0,
                    clientY: 0
                });
                document.body.dispatchEvent(clickEvent);
            }
            
            const baseUrl = this.getBaseServerUrl();
            const apiPath = '/cgi/ThirdParty/all.editor/index.cgi';
            let previewUrl = `${baseUrl}${apiPath}`;
            let filename = '万能编辑器';
            let fullPath = '';

            if (fileRow && fileRow.hasAttribute('data-path')) {
                fullPath = fileRow.getAttribute('data-path');
                filename = this.getFileName(fileRow);
                if (this.isFolder(fileRow)) {
                    previewUrl += `?floderpath=/${encodeURIComponent(fullPath)}`;
                } else {
                    previewUrl += `?path=/${encodeURIComponent(fullPath)}`;
                }
            } else {
                // 右击空白区域，使用当前目录
                fullPath = this.getCurrentDirectory();
                filename = '万能编辑器 - ' + fullPath;
                previewUrl += `?floderpath=/${encodeURIComponent(fullPath)}`;
            }

            // 延迟执行，让菜单先关闭
            setTimeout(() => {
                this.openOriginalTextPreview(previewUrl, filename, fullPath);
            }, 100);
        });

        // 将新项添加到菜单中
        const container = menu.querySelector('.ms-container .relative:last-child');
        if (container) {
            container.parentElement.insertBefore(newItem, container.nextSibling);
        } else {
            const msContainer = menu.querySelector('.ms-container');
            if (msContainer) {
                msContainer.appendChild(newItem);
            }
        }
    };

    // 导出到全局
    window.FileManagerEnhancer = FilePreviewEnhancer;
    window.FileTypeDetector = FileTypeDetector;

})(window, document);