Object.prototype.extend = function (source) {
    for (var i in source) {
        if (source.hasOwnProperty(i)) {
            this[i] = source[i];
        }
    }
    return this;
};
if (!Array.prototype.find) {
    Array.prototype.find = function (predicate) {
        if (typeof predicate !== 'function') {
            throw new TypeError('predicate must be a function');
        }
        var list = Object(this);
        var length = list.length >>> 0;
        var thisArg = arguments[1];
        var value;
        
        for (var i = 0; i < length; i++) {
            value = list[i];
            if (predicate.call(thisArg, value, i, list)) {
                return value;
            }
        }
        return undefined;
    };
}

function Grid($container, data, columns, options) {
    var defaults = {
        enableAsyncPostRender: false,
        asyncPostRenderDelay: 10,
        rowHeight: 24,
        defaultFormatter: defaultFormatter,
    };
    var columnDefaults = {
        name: "",
        width: 100
    };
    
    var columnPosLeft = [];
    var columnPosRight = [];
    
    var viewportW, viewportH;
    var numVisibleRows;
    var viewportHasHScroll, viewportHasVScroll;
    var numberOfRows;
    var rowsCache = [];
    var postProcessedRows = [];
    var virtualHeight;
    var scrollableHeight;
    var pageHeight;
    var numberOfPages;
    var jumpinessCoeff;
    var page;
    var offset;
    var canvasWidth;
    var $style;
    
    var minBuffer = 3;
    var columnCssRulesL, columnCssRulesR, stylesheet;
    
    var vScrollDir;
    
    var lastRenderedScrollTop, lastRenderedScrollLeft;
    var prevScrollTop = 0, prevScrollLeft = 0;
    var scrollTop, scrollLeft;
    
    var renderTimeout = 50;
    
    
    if ($container instanceof Node === false) {
        throw new Error("Grid requires a valid container, " + $container + " does not exist in the DOM.");
    }
    
    var maxSupportedCssHeight = (function getMaxSupportedCssHeight() {
        var supportedHeight = 1000000;
        
        var testUpTo = 1000000000;
        
        var div = document.createElement('div');
        document.body.appendChild(div);
        
        while (true) {
            var test = supportedHeight * 2;
            
            div.style.height = test + 'px';
            if (test > testUpTo || div.offsetHeight !== test) {
                break;
            } else {
                supportedHeight = test;
            }
        }
        
        document.body.removeChild(div);
        return supportedHeight;
    })();

    var scrollbarDimensions = (function measureScrollbar() {
        var div = document.createElement('div');
        div.style.overflow = 'scroll';
        document.body.appendChild(div);
        var dim = {
            width: div.offsetWidth - div.clientWidth,
            height: div.offsetHeight - div.clientHeight
        };
        document.body.removeChild(div);
        return dim;
    })();
    
    if (options === undefined) {
        options = {};
    }
    options = defaults.extend(options);
    
    var columnsById = {};
    columns.forEach(initColumn);
    function initColumn(column, index) {
        var columnDefaultsCopy = {}.extend(columnDefaults);
        column = columnDefaultsCopy.extend(column);
        columns[index] = column;
        columnsById[column.id] = index;
        if (column.minWidth && column.width < column.minWidth) {
            column.width = column.minWidth;
        }
        if (column.maxWidth && column.width > column.maxWidth) {
            column.width = column.maxWidth;
        }
    }
    
    var uid = "grid" + Math.round(1000000 * Math.random());
    $container.classList.add(uid);
    
    var $headerScroller = document.createElement('div');
    $headerScroller.classList.add('grid-header');
    $container.appendChild($headerScroller);
    
    var $headers = document.createElement('div');
    $headers.classList.add('header-columns');
    $headers.style.left = '-1000px';
    $headerScroller.appendChild($headers);
    
    var $viewport = document.createElement('div');
    $viewport.classList.add('viewport');
    $container.appendChild($viewport);
    
    var $canvas = document.createElement('div');
    $canvas.classList.add('grid-canvas');
    $viewport.appendChild($canvas);
    
    viewportW = parseFloat($container.offsetWidth);
    
    (function updateColumnCaches() {
        
        columnPosLeft = [];
        columnPosRight = [];
        var x = 0;
        columns.forEach(function (column, i) {
            columnPosLeft[i] = x;
            columnPosRight[i] = x + column.width;
            x += column.width;
        });
    })();
    
    (function createColumnHeaders() {
        
        $headers.innerHTML = "";
        $headers.style.width = getHeadersWidth() + 'px';
        
        columns.forEach(compileAndAddHeaderColumn);
        
        function compileAndAddHeaderColumn(column) {
            
            var header = document.createElement('div');
            header.classList.add('header-column');
            header.style.width = column.width + 'px';
            header.id = uid + column.id;
            
            if (column.tooltip) {
                header.title = column.tooltip;
            }
            header.data = {
                column: column
            };
            if (column.headerCssClass) {
                header.classList.add(column.headerCssClass);
            }
            
            var title = document.createElement('span');
            title.classList.add('column-name');
            title.textContent = column.name;
            
            header.appendChild(title);
            
            $headers.appendChild(header);
        }

        function getHeadersWidth() {
            var headersWidth = columns.reduce(function (sum, header) {
                return sum + header.width;
            }, 0);

            headersWidth += scrollbarDimensions.width;
            return Math.max(headersWidth, viewportW) + 1000;
        }
    })();
    
    (function createCssRules() {
        $style = document.createElement('style');
        $style.setAttribute('rel', 'stylesheet');
        document.head.appendChild($style);
        
        var rowHeight = options.rowHeight;
        var rules = [
        "." + uid + " .header-column { left: 1000px; }",
        "." + uid + " .grid-cell { height:" + rowHeight + "px; }",
        "." + uid + " .grid-row { height:" + options.rowHeight + "px; }"
        ];
        
        for (var i = 0; i < columns.length; i++) {
            rules.push("." + uid + " .l" + i + " { }");
            rules.push("." + uid + " .r" + i + " { }");
        }

        $style.appendChild(document.createTextNode(rules.join(" ")));
    })();
    
    resizeCanvas();
    
    $container.addEventListener('resize', resizeCanvas);
    
    $viewport.addEventListener("scroll", handleScroll);
    
    //$canvas.addEventListener("keydown", handleKeyDown);
    //$canvas.addEventListener("click", handleClick);
    //$canvas.addEventListener("dblclick", handleDblClick);
    
    function resizeCanvas() {
        if (options.autoHeight) {
            viewportH = options.rowHeight * getDataLength();
        } else {
            viewportH = $container.clientHeight - $headerScroller.offsetHeight;
        }
        
        numVisibleRows = Math.ceil(viewportH / options.rowHeight);
        viewportW = parseFloat($container.offsetWidth);
        $viewport.style.height = viewportH + 'px';
        
        
        //if (options.forceFitColumns) {
        //    autosizeColumns();
        //}
        
        (function updateRowCount() {
            
            var dataLength = getDataLength();
            
            numberOfRows = dataLength;
            
            
            viewportHasVScroll = !options.autoHeight && (numberOfRows * options.rowHeight > viewportH);
            
            // remove the rows that are now outside of the data range
            // this helps avoid redundant calls to .removeRow() when the size of the data decreased by thousands of rows
            var l = options.enableAddRow ? dataLength : dataLength - 1;
            for (var i in rowsCache) {
                if (i >= l) {
                    removeRowFromCache(rowsCache[i], i);
                }
            }
            
            var oldH = scrollableHeight;
            virtualHeight = Math.max(options.rowHeight * numberOfRows, viewportH - scrollbarDimensions.height);
            if (virtualHeight < maxSupportedCssHeight) {
                // just one page
                scrollableHeight = pageHeight = virtualHeight;
                numberOfPages = 1;
                jumpinessCoeff = 0;
            } else {
                // break into pages
                scrollableHeight = maxSupportedCssHeight;
                pageHeight = scrollableHeight / 100;
                numberOfPages = Math.floor(virtualHeight / pageHeight);
                jumpinessCoeff = (virtualHeight - scrollableHeight) / (numberOfPages - 1);
            }
            
            if (scrollableHeight !== oldH) {
                $canvas.style.height = scrollableHeight + 'px';
                scrollTop = $viewport.scrollTop;
            }
            
            var oldScrollTopInRange = (scrollTop + offset <= virtualHeight - viewportH);
            
            if (virtualHeight === 0 || scrollTop === 0) {
                page = offset = 0;
            } else if (oldScrollTopInRange) {
                // maintain virtual position
                scrollTo(scrollTop + offset);
            } else {
                // scroll to bottom
                scrollTo(virtualHeight - viewportH);
            }
            
            if (scrollableHeight != oldH && options.autoHeight) {
                resizeCanvas();
            }
            
            updateCanvasWidth(false);
            
            function updateCanvasWidth(forceColumnWidthsUpdate) {
                var oldCanvasWidth = canvasWidth;
                canvasWidth = getCanvasWidth();
                
                if (canvasWidth != oldCanvasWidth) {
                    $canvas.style.width = canvasWidth + 'px';
                    $headers.style.width = getHeadersWidth() + 'px';
                    viewportHasHScroll = (canvasWidth > viewportW - scrollbarDimensions.width);
                }
                
                if (canvasWidth != oldCanvasWidth || forceColumnWidthsUpdate) {
                    applyColumnWidths();
                }
                
                function getCanvasWidth() {
                    var availableWidth = viewportHasVScroll ? viewportW - scrollbarDimensions.width : viewportW;
                    
                    var rowWidth = columns.reduce(function (sum, header) {
                        return sum + header.width;
                    }, 0);
                    
                    return options.fullWidthRows ? Math.max(rowWidth, availableWidth) : rowWidth;
                }
                
                function applyColumnWidths() {
                    var x = 0;
                    columns.forEach(function (column, idx) {
                        
                        var rule = getColumnCssRules(idx);
                        rule.left.style.left = x + "px";
                        rule.right.style.right = (canvasWidth - x - column.width) + "px";
                        
                        x += column.width;
                    });
                    
                    function getColumnCssRules(idx) {
                        if (!stylesheet) {
                            
                            stylesheet = Array.prototype.find.call(document.styleSheets, function (sheet) {
                                return (sheet.ownerNode || sheet.owningElement) == $style;
                            });
                            
                            if (!stylesheet) {
                                throw new Error("Cannot find stylesheet.");
                            }
                            
                            // find and cache column CSS rules
                            columnCssRulesL = [];
                            columnCssRulesR = [];
                            var cssRules = (stylesheet.cssRules || stylesheet.rules);
                            var matches, columnIdx;
                            
                            Array.prototype.forEach.call(cssRules, function (rule) {
                                var selector = rule.selectorText;
                                if (matches = /\.l\d+/.exec(selector)) {
                                    columnIdx = parseInt(matches[0].substr(2, matches[0].length - 2), 10);
                                    columnCssRulesL[columnIdx] = rule;
                                } else if (matches = /\.r\d+/.exec(selector)) {
                                    columnIdx = parseInt(matches[0].substr(2, matches[0].length - 2), 10);
                                    columnCssRulesR[columnIdx] = rule;
                                }
                            });
                        }
                        
                        return {
                            left: columnCssRulesL[idx],
                            right: columnCssRulesR[idx]
                        };
                    }
                }
            }
        })();
        handleScroll();
        render();
    }
    
    function removeRowFromCache(row, index) {
        var cacheEntry = rowsCache[index];
        if (!cacheEntry) {
            return;
        }
        $canvas.removeChild(cacheEntry.rowNode);
        delete rowsCache[index];
        delete postProcessedRows[index];

    }
    
    function scrollTo(y) {
        y = Math.max(y, 0);
        y = Math.min(y, virtualHeight - viewportH + (viewportHasHScroll ? scrollbarDimensions.height : 0));
        
        var oldOffset = offset;
        
        page = Math.min(numberOfPages - 1, Math.floor(y / pageHeight));
        offset = Math.round(page * jumpinessCoeff);
        var newScrollTop = y - offset;
        
        if (offset != oldOffset) {
            var range = getVisibleRange(newScrollTop);
            cleanupRows(range);
            updateRowPositions();
        }
        
        if (prevScrollTop != newScrollTop) {
            vScrollDir = (prevScrollTop + oldOffset < newScrollTop + offset) ? 1 : -1;
            $viewport.scrollTop = (lastRenderedScrollTop = scrollTop = prevScrollTop = newScrollTop);

        }
        
        function updateRowPositions() {
            rowsCache.forEach(function (row) {
                row.rowNode.style.top = getRowTop(row) + "px";
            });
        }
    }
    
    function cleanupRows(rangeToKeep) {
        rowsCache.forEach(function (row, index) {
            if (index < rangeToKeep.top || index > rangeToKeep.bottom) {
                removeRowFromCache(row, index);
            }
        });
    }
    
    function getRowTop(row) {
        return options.rowHeight * row - offset;
    }
    
    function handleScroll() {
        
        scrollTop = $viewport.scrollTop;
        scrollLeft = $viewport.scrollLeft;
        var vScrollDist = Math.abs(scrollTop - prevScrollTop);
        var hScrollDist = Math.abs(scrollLeft - prevScrollLeft);
        
        if (hScrollDist !== 0) {
            prevScrollLeft = scrollLeft;
            $headerScroller.scrollLeft = scrollLeft;
        }
        
        if (vScrollDist !== 0) {
            vScrollDir = prevScrollTop < scrollTop ? 1 : -1;
            prevScrollTop = scrollTop;
            
            // switch virtual pages if needed
            if (vScrollDist < viewportH) {
                scrollTo(scrollTop + offset);
            } else {
                var oldOffset = offset;
                if (scrollableHeight == viewportH) {
                    page = 0;
                } else {
                    page = Math.min(numberOfPages - 1, Math.floor(scrollTop * ((virtualHeight - viewportH) / (scrollableHeight - viewportH)) * (1 / pageHeight)));
                }
                offset = Math.round(page * jumpinessCoeff);
                if (oldOffset != offset) {
                    invalidateAllRows();
                }
            }
        }
        
        if (hScrollDist > 0 || vScrollDist > 0) {
            if (renderTimeout) {
                clearTimeout(renderTimeout);
            }
            
            if (Math.abs(lastRenderedScrollTop - scrollTop) > 20 ||
                Math.abs(lastRenderedScrollLeft - scrollLeft) > 20) {
                
                if (options.forceSyncScrolling || (
                    Math.abs(lastRenderedScrollTop - scrollTop) < viewportH &&
                        Math.abs(lastRenderedScrollLeft - scrollLeft) < viewportW)) {
                    
                    render();
                } else {
                    renderTimeout = setTimeout(render, renderTimeout);
                }
            }
        }

    }
    
    function render() {
        var renderedRows = getRenderedRange();
        
        // remove rows no longer in the viewport
        cleanupRows(renderedRows);
        
        // add new rows & missing cells in existing rows
        if (lastRenderedScrollLeft != scrollLeft) {
            cleanUpAndRenderCells(renderedRows);
        }
        
        // render missing rows
        renderRows(renderedRows);
        
        lastRenderedScrollTop = scrollTop;
        lastRenderedScrollLeft = scrollLeft;
        renderTimeout = null;

        function getRenderedRange(viewportTop, viewportLeft) {
            var range = getVisibleRange(viewportTop, viewportLeft);
            var buffer = Math.round(viewportH / options.rowHeight);
            
            if (vScrollDir == -1) {
                range.top -= buffer;
                range.bottom += minBuffer;
            } else if (vScrollDir == 1) {
                range.top -= minBuffer;
                range.bottom += buffer;
            } else {
                range.top -= minBuffer;
                range.bottom += minBuffer;
            }
            
            range.top = Math.max(0, range.top);
            range.bottom = Math.min(getDataLength() - 1, range.bottom);
            
            range.leftPx -= viewportW;
            range.rightPx += viewportW;
            
            range.leftPx = Math.max(0, range.leftPx);
            range.rightPx = Math.min(canvasWidth, range.rightPx);
            
            return range;
        }

        function cleanUpAndRenderCells(range) {
            var cacheEntry;
            var stringArray = [];
            var processedRows = [];
            var colspan;
            
            for (var row = range.top, btm = range.bottom; row <= btm; row++) {
                cacheEntry = rowsCache[row];
                if (!cacheEntry) {
                    continue;
                }
                
                // cellRenderQueue populated in renderRows() needs to be cleared first
                ensureCellNodesInRowsCache(row);
                
                cleanUpCells(range, row);
                
                // Render missing cells.
                var cellsAdded = 0;
                
                var metadata = data.getItemMetadata && data.getItemMetadata(row);
                metadata = metadata && metadata.columns;
                
                var dataItem = getDataItem(row);
                
                // TODO:  shorten this loop (index? heuristics? binary search?)
                for (var i = 0, ii = columns.length; i < ii; i++) {
                    // Cells to the right are outside the range.
                    if (columnPosLeft[i] > range.rightPx) {
                        break;
                    }
                    
                    // Already rendered.
                    if ((colspan = cacheEntry.cellColSpans[i]) != null) {
                        i += (colspan > 1 ? colspan - 1 : 0);
                        continue;
                    }
                    
                    colspan = 1;
                    if (metadata) {
                        var columnData = metadata[columns[i].id] || metadata[i];
                        colspan = (columnData && columnData.colspan) || 1;
                        if (colspan === "*") {
                            colspan = ii - i;
                        }
                    }
                    var columnLeftPx = columnPosRight[Math.min(ii - 1, i + colspan - 1)];
                    if (columnLeftPx > range.leftPx) {
                        var cellHtml = getCellHtml(row, i, colspan, dataItem);
                        stringArray.push(cellHtml.outerHTML);
                        cellsAdded++;
                    }
                    
                    i += (colspan > 1 ? colspan - 1 : 0);
                }
                
                if (cellsAdded) {
                    processedRows.push(row);
                }
            }
            
            if (!stringArray.length) {
                return;
            }
            
            var x = document.createElement("div");
            x.innerHTML = stringArray.join("");
            
            processedRows.forEach(processRow);
            processedRows.length = 0;
            
            function processRow(processedRow) {
                cacheEntry = rowsCache[processedRow];
                var columnIdx;
                while ((columnIdx = cacheEntry.cellRenderQueue.pop()) != null) {
                    var node = x.lastChild;
                    cacheEntry.rowNode.appendChild(node);
                    cacheEntry.cellNodesByColumnIdx[columnIdx] = node;
                }
            }

            function cleanUpCells(range, row) {
                var cacheEntry = rowsCache[row];
                
                // Remove cells outside the range.
                var cellsToRemove = [];
                
                cacheEntry.cellNodesByColumnIdx.forEach(function (cellNode, i) {
                    
                    var colspan = cacheEntry.cellColSpans[i];
                    
                    if (columnPosLeft[i] > range.rightPx ||
                columnPosRight[Math.min(columns.length - 1, i + colspan - 1)] < range.leftPx) {
                        
                        cellsToRemove.push(i);
                    }
                });
                
                
                cellsToRemove.forEach(removeCell);
                cellsToRemove.length = 0;
                
                function removeCell(cellToRemove) {
                    var cellNode = cacheEntry.cellNodesByColumnIdx[cellToRemove];
                    
                    cacheEntry.rowNode.removeChild(cellNode);
                    
                    delete cacheEntry.cellColSpans[cellToRemove];
                    delete cacheEntry.cellNodesByColumnIdx[cellToRemove];
                    
                    if (postProcessedRows[row]) {
                        delete postProcessedRows[row][cellToRemove];
                    }
                }
            }
        }
    }
    
    function getVisibleRange(viewportTop, viewportLeft) {
        if (viewportTop == null) {
            viewportTop = scrollTop;
        }
        if (viewportLeft == null) {
            viewportLeft = scrollLeft;
        }
        
        return {
            top: getRowFromPosition(viewportTop),
            bottom: getRowFromPosition(viewportTop + viewportH) + 1,
            leftPx: viewportLeft,
            rightPx: viewportLeft + viewportW
        };
        
        function getRowFromPosition(y) {
            return Math.floor((y + offset) / options.rowHeight);
        }
    }
    
    function ensureCellNodesInRowsCache(row) {
        var cacheEntry = rowsCache[row];
        if (cacheEntry && cacheEntry.cellRenderQueue.length) {
            var lastChild = cacheEntry.rowNode.lastChild;
            while (cacheEntry.cellRenderQueue.length) {
                var columnIdx = cacheEntry.cellRenderQueue.pop();
                cacheEntry.cellNodesByColumnIdx[columnIdx] = lastChild;
                lastChild = lastChild.previousSibling;
            }
        }
    }
    
    function getCellHtml(row, cell, colspan, item) {
        var column = columns[cell];
        
        var element = document.createElement('div');
        element.classList.add('grid-cell');
        element.classList.add('l' + cell);
        element.classList.add('r' + Math.min(columns.length - 1, cell + colspan - 1));
        
        if (column.cssClass) {
            element.classList.add(column.cssClass);
        }
        
        // if there is a corresponding row (if not, this is the Add New row or this data hasn't been loaded yet)
        if (item) {
            //var value = getDataItemValueForColumn(item, column);
            var value = item[column.field];
            var cellFormatter = getFormatter(row, column);
            var cellText = cellFormatter(row, cell, value, column, item);
            element.innerHTML = cellText;
        }
        
        rowsCache[row].cellRenderQueue.push(cell);
        rowsCache[row].cellColSpans[cell] = colspan;
        
        return element;

        function getFormatter(row, column) {
            var rowMetadata = data.getItemMetadata && data.getItemMetadata(row);
            
            // look up by id, then index
            var columnOverrides = rowMetadata &&
            rowMetadata.columns &&
            (rowMetadata.columns[column.id] || rowMetadata.columns[getColumnIndex(column.id)]);
            
            return (columnOverrides && columnOverrides.formatter) ||
            (rowMetadata && rowMetadata.formatter) ||
            column.formatter || options.defaultFormatter;
        }
    }
    
    function defaultFormatter(row, cell, value) {
        if (value == null) {
            return "";
        } else {
            return (value + "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }
    }
    
    function renderRows(range) {
        
        var fragment = document.createDocumentFragment();
        
        var rowsToRender = [];
        
        for (var i = range.top; i <= range.bottom; i++) {
            if (rowsCache[i]) {
                continue;
            }
            rowsToRender.push(i);
            
            // Create an entry right away so that appendRowHtml() can
            // start populatating it.
            rowsCache[i] = {
                rowNode: null,
                
                // ColSpans of rendered cells (by column idx).
                // Can also be used for checking whether a cell has been rendered.
                cellColSpans: [],
                
                // Cell nodes (by column idx).  Lazy-populated by ensureCellNodesInRowsCache().
                cellNodesByColumnIdx: [],
                
                // Column indices of cell nodes that have been rendered, but not yet indexed in
                // cellNodesByColumnIdx.  These are in the same order as cell nodes added at the
                // end of the row.
                cellRenderQueue: []
            };
            var rowHtml = getRowHtml(i, range);
            rowsCache[i].rowNode = rowHtml;

            fragment.appendChild(rowHtml);
        }
        
        $canvas.appendChild(fragment);

        function getRowHtml(row, range) {
            
            var rowElement = document.createElement('div');
            var dataItem = getDataItem(row);
            
            rowElement.classList.add('grid-row');
            
            var rowMetadata = data.getItemMetadata && data.getItemMetadata(row);
            
            if (rowMetadata && rowMetadata.cssClasses) {
                rowElement.classList.add(rowMetadata.cssClasses);
            }
            
            rowElement.style.top = getRowTop(row) + "px";
            
            for (var j = 0; j < columns.length; j++) {
                var column = columns[j];
                var colspan = 1;
                if (rowMetadata && rowMetadata.columns) {
                    var columnData = rowMetadata.columns[column.id] || rowMetadata.columns[j];
                    colspan = (columnData && columnData.colspan) || 1;
                    if (colspan === "*") {
                        colspan = columns.length - j;
                    }
                }
                
                // Do not render cells outside of the viewport.
                var cloumnRightPx = columnPosRight[Math.min(columns.length - 1, j + colspan - 1)];
                if (cloumnRightPx > range.leftPx) {
                    if (columnPosLeft[j] > range.rightPx) {
                        // All columns to the right are outside the range.
                        break;
                    }
                    
                    var cell = getCellHtml(row, j, colspan, dataItem);
                    rowElement.appendChild(cell);
                }
                
                if (colspan > 1) {
                    j += (colspan - 1);
                }
            }
            
            return rowElement;
        }
    }
    
    function invalidateAllRows() {
        rowsCache.forEach(removeRowFromCache);
    }
    
    //#region data methods
    function getDataLength() {
        if (data.getLength) {
            return data.getLength();
        } else {
            return data.length;
        }
    }
    
    function getDataItem(i) {
        if (data.getItem) {
            return data.getItem(i);
        } else {
            return data[i];
        }
    }
    //#endregion
    
    return {
        render: render,
        resizeCanvas: resizeCanvas,
        setData: function (newData) {
            data = newData;
            invalidateAllRows();
            render();
        },
        getDataLength: getDataLength,
        getDataItem: getDataItem
        
    };
}