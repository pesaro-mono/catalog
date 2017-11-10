import gulp from 'gulp';
import gulpLoadPlugins from 'gulp-load-plugins';
import del from 'del';
import browserSync from 'browser-sync';
import rs from 'run-sequence';
import cssnext from 'postcss-cssnext';
import cssAssets from 'postcss-assets';
import pugIncludeGlob from 'pug-include-glob';
import named from 'vinyl-named';
import webpack from 'webpack-stream';
import webpackDevConfig from './webpack.dev.config.babel';
import webpackProdConfig from './webpack.prod.config.babel';
import notifier from 'node-notifier';
import yargs from 'yargs';
import fs from 'fs';
import imageminJpegRecompress from 'imagemin-jpeg-recompress';

const $ = gulpLoadPlugins();
const reload = browserSync.reload;
const argv = yargs.boolean(['minify', 'staging', 'prod']).argv;

const currentProject = 'official-site';

const basePath = {
  src: 'src',
  dist: 'dist',
};

const buildDest = `${basePath.dist}/${currentProject}`

const paths = {
  pug: `${basePath.src}/pug/`,
  sass: `${basePath.src}/sass/`,
  images: `${basePath.src}/assets/`,
  scripts: `${basePath.src}/scripts/`,
  html: basePath.dist,
  css: `${buildDest}/assets/stylesheets/`,
  assets: `${buildDest}/assets/`,
  js: `${buildDest}/assets/scripts/`,
};

const remotePaths = {
  folderName: 'pesaro',
  production: 'https://sorarize.github.io/pesaro/'
};

const plumberOption = {
  errorHandler(error) {
    notifier.notify({
      title: 'gulp error',
      message: error.message
    });
    console.log(error.message);
    this.emit('end');
  },
};

gulp.task('default', (cb) => rs('clean', 'compile', 'server', cb));
gulp.task('build', (cb) => rs('clean', 'compile', 'rename-project-folder', cb));

gulp.task('rev', () =>
   gulp.src(`${buildDest}/**`)
    .pipe($.revAll.revision({dontRenameFile: ['.html']}))
    .pipe(gulp.dest(buildDest))
);

// compile start
// ------------------------------------------------------------------

gulp.task('compile', (cb) => rs('assets', ['sass', 'pug', 'js'], cb));

gulp.task('clean', () => {
  del.sync(basePath.dist);
});

gulp.task('assets', (cb) => {
  gulp.src(`${paths.images}**/*.{jpg,jpeg,png,gif,svg,cur,mp4}`)
    .pipe($.if(argv.minify,
      $.imagemin([
        imageminJpegRecompress({
          min: 50,
          max: 80
        })
      ],{
        verbose: true,
        svgoPlugins: [
          {cleanupIDs: false},
          {mergePaths: false}
        ]
      })
    ))
    .pipe(gulp.dest(paths.assets))
    .on('end', cb);
});

gulp.task('sass', (cb) => {
  const processors = [
    cssnext(),
    cssAssets({
      basePath: paths.assets,
      baseUrl: '../',
      loadPaths: ['images']
    })
  ];

  let env = 'dev';
  if (argv.staging) env = 'staging';
  if (argv.prod) env = 'production';

  gulp.src(`${paths.sass}**/*.sass`)
    .pipe($.plumber(plumberOption))
    .pipe($.preprocess({context: { ENV: env }}))
    .pipe($.sassGlob())
    .pipe($.sass.sync({
      precision: 10,
      includePaths: [
        './node_modules/reset-css',
        './node_modules/sass-mq',
        './node_modules/mathsass/dist',
        './node_modules/slick-carousel/slick',
        './node_modules/font-awesome/scss',
        './node_modules/lity/dist'
      ]
    }))
    .pipe($.postcss(processors))
    .pipe($.if(argv.minify, $.cssnano({discardComments: { removeAll: true }})))
    .pipe(gulp.dest(paths.css))
    .on('end', cb)
    .pipe(browserSync.stream())
});

function getPugHelpers(pugPath) {
  let rootPath = `/`;
  let pagePath = pugPath.replace(`${__dirname}/${paths.pug}`, '').replace('.pug', '').split('/');
  pagePath.shift();
  pagePath = pagePath.join('/');

  const folderName = (argv.prod || argv.staging) ? `/${remotePaths.folderName}` : '';

  if (argv.prod) {
    rootPath = remotePaths.production;
  } else if (argv.staging) {
    rootPath = remotePaths.staging;
  }

  return {
    imageUrl: (filePath) => `${folderName}/assets/images/${filePath}`,
    cssUrl: (filePath) => `${folderName}/assets/stylesheets/${filePath}`,
    jsUrl: (filePath) => `${folderName}/assets/scripts/${filePath}`,
    isProd: argv.prod,
    rootPath,
    pagePath
  }
};

gulp.task('pug', (cb) => {
  gulp.src(`${paths.pug}**/*.pug`)
    .pipe($.plumber(plumberOption))
    .pipe($.changed(paths.html, { extension: '.html' }))
    .pipe($.cached('pug'))
    .pipe($.pugInheritance({ basedir: paths.pug.slice(0, -1), skip: 'node_modules' }))
    .pipe($.filter((file) => !/\/_/.test(file.path) && !/^_/.test(file.relative)))
    .pipe($.tap((file, t) => {
      t.through($.data, [getPugHelpers(file.path)]);
    }))
    .pipe($.pug({
      pretty: false,
      basedir: paths.pug,
      plugins: [pugIncludeGlob()],
    }))
    .pipe(gulp.dest(paths.html))
    .on('end', cb);
});

gulp.task('js', (cb) => {
  gulp.src([`${paths.scripts}index.js`])
    .pipe(named())
    .pipe($.plumber(plumberOption))
    .pipe($.if(argv.minify, webpack(webpackProdConfig), webpack(webpackDevConfig)))
    .pipe(gulp.dest(paths.js))
    .on('end', cb);
});


// compile end
// ------------------------------------------------------------------

gulp.task('server', () => {
  const watchPair = [
    `${paths.pug}**/*.pug`,          ['pug', reload],
    `${paths.sass}**/*.{sass,scss}`, ['sass'],
    `${paths.images}**/*`,           ['assets', reload],
    `${paths.scripts}**/*`,          ['js', reload]
  ];

  watchPair.forEach((files, i, arr) => {
    if (i % 2 == 0) {
      $.watch(files, () => rs.apply(null, arr[i+1]));
    };
  });

  browserSync({
    open: 'external',
    notify: false,
    server: {
      baseDir: buildDest,
      index: 'index.html',
      serveStaticOptions: {
        extensions: 'html'
      }
    }
  });
});

gulp.task('rename-project-folder', (cb) => {
  fs.rename(buildDest, `docs`, function (err) {
    if (err) {
      throw err;
    }
    cb();
  });
});
